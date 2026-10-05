from datetime import date

import pytest

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.demo_backend import DEMO_NOW, DemoBackend
from studyflow_ai.import_jobs import Actor, Confirmation, ImportService, MemoryJobStore
from studyflow_ai.models import CallRecord, Classification, IngestContext, RouteContext, Source
from studyflow_ai.orchestration import CheckInProgress
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.providers.rules import RuleProvider
from studyflow_ai.routing import Router


def test_low_probability_requires_review():
    class Uncertain(RuleProvider):
        def classify(self, text):
            return Classification(
                category="rent",
                probabilities={"rent": 0.51, "other": 0.49},
                financial_relevance=0.7,
                anomaly=0,
                needs_planning=0,
            ), self.record("classify")

    assert Router(Uncertain()).route(RouteContext(text="ambiguous")).action == "REVIEW"


def test_jev_down_does_not_suppress_backend_risk():
    class Broken(RuleProvider):
        def classify(self, text):
            raise ProviderFailure(
                "TIMEOUT",
                CallRecord(
                    provider="typesafe",
                    purpose="classify",
                    model="m",
                    mode="live",
                    error_code="TIMEOUT",
                ),
            )

    result = Router(Broken()).route(RouteContext(deterministic_risk=True))
    assert result.action == "PLAN"
    assert result.calls[0].error_code == "TIMEOUT"


def test_import_preserves_commit_when_check_crashes():
    ai = StudyFlowAI(RuleProvider(), RuleProvider(), DemoBackend(seeded=False))

    def broken(*args):
        raise ConnectionError("offline")

    ai.run_check = broken
    service = ImportService(ai, MemoryJobStore())
    actor = Actor(actor_id="a", student_id="student_001")
    job = service.create(actor, DEMO_NOW.date())
    service.process(
        job.job_id,
        Source(
            source_id="source",
            kind="email",
            text="Tuition THB 65000 due 2026-10-15. Beneficiary: PSU",
        ),
        DEMO_NOW,
    )
    result = service.confirm(job.job_id, Confirmation(), actor, DEMO_NOW)
    assert result.stage == "COMMITTED" and result.error_code == "CHECK_RETRY_REQUIRED"


def test_overlapping_checks_do_not_duplicate_model_calls():
    class Busy(DemoBackend):
        def claim_check(self, key):
            return False

    ai = StudyFlowAI(RuleProvider(), RuleProvider(), Busy())
    with pytest.raises(CheckInProgress):
        ai.run_check("student_001", "timer", DEMO_NOW)


def test_persistent_state_churn_returns_stale():
    class Changing(DemoBackend):
        def save_check(self, key, result):
            self.state.state_version += 1
            return False

    ai = StudyFlowAI(RuleProvider(), RuleProvider(), Changing())
    result = ai.run_check("student_001", "timer", DEMO_NOW)
    assert result.stale
    assert result.planning[0].plans[0].validation == "STALE"


@pytest.mark.parametrize("text", ["", "   ", "\n"])
def test_empty_source_rejected(text):
    ai = StudyFlowAI(RuleProvider(), RuleProvider())
    result = ai.ingest(
        Source(source_id="s", kind="email", text=text),
        IngestContext(reference_date=date(2026, 10, 2)),
    )
    assert result.status == "REJECTED"


def test_changed_beneficiary_needs_review_even_on_trusted_source():
    ai = StudyFlowAI(RuleProvider(), RuleProvider())
    context = IngestContext(
        reference_date=DEMO_NOW.date(),
        verified_source_ids=["s"],
        verification_reference="user-confirmed",
        known_beneficiaries=["PSU"],
    )
    result = ai.ingest(
        Source(
            source_id="s",
            kind="email",
            text="Tuition THB 65000 due 2026-10-15. Beneficiary: Personal Account",
        ),
        context,
    )
    assert any(i.code == "BENEFICIARY_MISMATCH" for i in result.candidates[0].issues)


def test_naive_check_time_rejected():
    ai = StudyFlowAI(RuleProvider(), RuleProvider(), DemoBackend())
    with pytest.raises(ValueError, match="timezone"):
        ai.run_check("student_001", "timer", DEMO_NOW.replace(tzinfo=None))
