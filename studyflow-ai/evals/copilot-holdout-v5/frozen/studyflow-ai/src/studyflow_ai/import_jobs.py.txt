"""Import application service; production job persistence is supplied by B."""

from datetime import date, datetime
from threading import RLock
from typing import Literal, Protocol
from uuid import uuid4

from pydantic import Field

from studyflow_ai.models import (
    AuditEvent,
    CandidateEvent,
    Contract,
    Evidence,
    IngestContext,
    IngestResult,
    Source,
    Status,
)
from studyflow_ai.privacy import redact
from studyflow_ai.validation import (
    _required_fields,
    candidate_key,
    mark_duplicates,
    transaction_key,
)


class Actor(Contract):
    actor_id: str
    student_id: str


class ImportJob(Contract):
    job_id: str = Field(default_factory=lambda: uuid4().hex)
    student_id: str
    reference_date: date
    stage: Literal["QUEUED", "PROCESSING", "NEEDS_REVIEW", "COMMITTED", "REJECTED", "FAILED"] = (
        "QUEUED"
    )
    result: IngestResult | None = None
    state_version: int | None = None
    error_code: str | None = None


class Correction(Contract):
    candidate_id: str
    amount: str | None = None
    currency: str | None = None
    date: str | None = None
    due_date: str | None = None
    counterparty: str | None = None
    invoice_id: str | None = None


class Confirmation(Contract):
    selected_candidate_ids: list[str] | None = None
    selected_transaction_locators: list[str] | None = None
    corrections: list[Correction] = Field(default_factory=list)


class JobStore(Protocol):
    def create(self, job: ImportJob) -> None: ...
    def get(self, job_id: str) -> ImportJob: ...
    def claim(self, job_id: str, expected: str) -> bool: ...
    def put(self, job: ImportJob) -> None: ...


class MemoryJobStore:
    """Single-process demo only. B must replace with durable, atomic storage."""

    def __init__(self):
        self.jobs, self.lock = {}, RLock()

    def create(self, job):
        with self.lock:
            self.jobs[job.job_id] = job.model_copy(deep=True)

    def get(self, job_id):
        with self.lock:
            return self.jobs[job_id].model_copy(deep=True)

    def claim(self, job_id, expected):
        with self.lock:
            if self.jobs[job_id].stage != expected:
                return False
            self.jobs[job_id].stage = "PROCESSING"
            return True

    def put(self, job):
        with self.lock:
            self.jobs[job.job_id] = job.model_copy(deep=True)


class ImportService:
    def __init__(self, ai, store: JobStore):
        self.ai, self.store = ai, store

    def create(self, actor, reference_date):
        job = ImportJob(student_id=actor.student_id, reference_date=reference_date)
        self.store.create(job)
        return job

    def get(self, job_id, actor):
        job = self.store.get(job_id)
        if job.student_id != actor.student_id:
            raise KeyError("Unknown import")
        return job

    def process(self, job_id, source: Source, now: datetime):
        if not self.store.claim(job_id, "QUEUED"):
            return
        job = self.store.get(job_id)
        try:
            context = IngestContext(student_id=job.student_id, reference_date=job.reference_date)
            job.result = self.ai.ingest(source, context)
            self._persist_result(job, now)
        except Exception:
            job.stage, job.error_code = "FAILED", "IMPORT_PROCESSING_FAILED"
        self.store.put(job)

    def confirm(self, job_id, confirmation: Confirmation, actor: Actor, now):
        job = self.get(job_id, actor)
        if job.stage == "COMMITTED":
            return job
        if not self.store.claim(job_id, "NEEDS_REVIEW"):
            raise ValueError("Import cannot be confirmed in its current state")
        try:
            job.result = confirmed_result(job.result, confirmation, actor)
            self._persist_result(job, now)
        except Exception:
            job.stage = "NEEDS_REVIEW"
            self.store.put(job)
            raise
        self.store.put(job)
        return job

    def _persist_result(self, job, now):
        result = job.result
        self.ai.backend.audit(
            AuditEvent(
                trace_id=result.trace_id,
                event="import_validated",
                timestamp=now,
                source_refs=result.source_refs,
                details={
                    "job_id": job.job_id,
                    "status": result.status,
                    "calls": [c.model_dump(mode="json") for c in result.calls],
                    "issues": [i.model_dump() for i in result.issues],
                    "candidates": redact([c.model_dump(mode="json") for c in result.candidates]),
                    "transactions": redact(
                        [t.model_dump(mode="json") for t in result.transactions]
                    ),
                },
            )
        )
        if result.status == Status.READY:
            job.state_version = self.ai.backend.accept_import(job.student_id, result)
            job.stage = "COMMITTED"
            try:
                self.ai.run_check(job.student_id, "import", now)
            except Exception:
                # The import has already committed; failure to plan cannot undo it.
                job.error_code = "CHECK_RETRY_REQUIRED"
        else:
            job.stage = "REJECTED" if result.status == Status.REJECTED else "NEEDS_REVIEW"


def _select(items, selected, key):
    if selected is None:
        return items
    if len(selected) != len(set(selected)) or not set(selected).issubset({key(x) for x in items}):
        raise ValueError("Unknown or duplicate selection")
    return [x for x in items if key(x) in selected]


def confirmed_result(original, confirmation, actor):
    result = original.model_copy(deep=True)
    if result.issues:
        raise ValueError("Correct source-level errors and submit a new import")
    result.candidates = _select(
        result.candidates, confirmation.selected_candidate_ids, lambda x: x.candidate_id
    )
    result.transactions = _select(
        result.transactions, confirmation.selected_transaction_locators, lambda x: x.locator
    )
    corrections = {c.candidate_id: c for c in confirmation.corrections}
    if not set(corrections).issubset({c.candidate_id for c in result.candidates}):
        raise ValueError("Correction references an unselected candidate")
    reference = f"user:{actor.actor_id}:confirmation:{uuid4().hex}"
    result.candidates = [
        _confirm_candidate(c, corrections.get(c.candidate_id), reference) for c in result.candidates
    ]
    for tx in result.transactions:
        tx.issues, tx.status = [], Status.READY
    mark_duplicates(result.candidates, candidate_key)
    mark_duplicates(result.transactions, transaction_key)
    if not result.candidates and not result.transactions:
        raise ValueError("Select at least one record")
    result.status = (
        Status.NEEDS_REVIEW
        if any(x.status != Status.READY for x in [*result.candidates, *result.transactions])
        else Status.READY
    )
    return result


def _confirm_candidate(candidate, correction, reference):
    data = candidate.model_dump()
    if correction:
        data.update(correction.model_dump(exclude_unset=True, exclude={"candidate_id"}))
    data.update(
        issues=[], status=Status.READY, verification_reference=reference, confidence_type="VERIFIED"
    )
    result = CandidateEvent.model_validate(data)
    _required_fields(result)
    result.evidence += [
        Evidence(
            source_id=reference,
            field=field,
            quote=str(getattr(result, field)),
            locator="user-confirmation",
        )
        for field in ("amount", "currency", "date", "due_date", "counterparty", "invoice_id")
        if getattr(result, field) is not None
    ]
    if result.issues:
        result.status = Status.NEEDS_REVIEW
    return result
