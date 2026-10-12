import hashlib
from zoneinfo import ZoneInfo

from studyflow_ai.models import AuditEvent, Status
from studyflow_ai.readiness.completeness import issue
from studyflow_ai.readiness.models import ReadinessResult


def _key(state, now):
    day = now.astimezone(ZoneInfo("Asia/Bangkok")).date()
    return hashlib.sha256(
        f"{state.student_id}:{state.state_version}:{state.budget_version}:{day}".encode()
    ).hexdigest()


def _audit(backend, result, now, event):
    audit = AuditEvent(
        trace_id=result.trace_id,
        event=event,
        timestamp=now,
        state_version=result.state_version,
        details={
            "budget_version": result.budget_version,
            "status": result.status,
            "issues": [i.code for i in result.issues],
            "calls": [c.model_dump(mode="json") for c in result.funding.calls]
            if result.funding
            else [],
        },
    )
    try:
        backend.audit(audit)
    except (ConnectionError, TimeoutError):
        result.status = Status.NEEDS_REVIEW
        result.issues.append(issue("AUDIT_UNAVAILABLE"))


def run_check(ai, student_id, trigger, now):
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("An aware clock is required")
    if ai.backend is None:
        return ReadinessResult(status=Status.NEEDS_REVIEW, issues=[issue("BACKEND_UNAVAILABLE")])
    result = ReadinessResult()
    for _ in range(2):
        try:
            state = ai.backend.read_readiness_state(student_id)
            key = _key(state, now)
            cached = ai.backend.get_readiness_check(key)
            if cached:
                cached = cached.model_copy(deep=True)
                cached.reused = True
                return cached
            if not ai.backend.claim_readiness_check(key):
                return ReadinessResult(
                    state_version=state.state_version,
                    budget_version=state.budget_version,
                    status=Status.NEEDS_REVIEW,
                    issues=[issue("CHECK_IN_PROGRESS")],
                )
            try:
                result, retry = _claimed(ai, state, (key, now, trigger))
                if not retry:
                    return result
            finally:
                ai.backend.release_readiness_check(key)
        except (ConnectionError, TimeoutError):
            result.status = Status.NEEDS_REVIEW
            result.issues.append(issue("BACKEND_UNAVAILABLE"))
            return result
    return result


def _claimed(ai, state, task):
    key, now, trigger = task
    result = ReadinessResult(
        state_version=state.state_version,
        budget_version=state.budget_version,
        completeness=ai.assess_cost_completeness(state.draft),
        source_refs=[p.source_id for p in state.draft.provenance],
    )
    try:
        budget = ai.backend.calculate_budget(state, now)
        if (budget.state_version, budget.budget_version) != (
            state.state_version,
            state.budget_version,
        ):
            raise ValueError("Version mismatch")
        result.budget = budget
        if not result.completeness.complete or not budget.complete:
            result.status = Status.NEEDS_REVIEW
            result.issues.append(issue("INCOMPLETE_BUDGET"))
        if budget.gap.amount > 0:
            context = ai.backend.funding_context(state, budget, now)
            if (
                context.budget != budget
                or context.student_id != state.student_id
                or context.now != now
            ):
                raise ValueError("Context mismatch")
            result.funding = ai.generate_funding_candidates(context)
            if result.funding.status != Status.READY:
                result.status = Status.NEEDS_REVIEW
    except (ConnectionError, TimeoutError):
        result.status = Status.NEEDS_REVIEW
        result.issues.append(issue("BACKEND_UNAVAILABLE"))
    except ValueError:
        result.status = Status.NEEDS_REVIEW
        result.issues.append(issue("BACKEND_CONTRACT_MISMATCH"))
    if _transient(result):
        _audit(ai.backend, result, now, "readiness_retry_required")
        return result, False
    try:
        if ai.backend.save_readiness_check(key, result):
            _audit(ai.backend, result, now, "readiness_" + trigger)
            return result, False
    except (ConnectionError, TimeoutError):
        result.status = Status.NEEDS_REVIEW
        result.issues.append(issue("BACKEND_PERSISTENCE_UNAVAILABLE"))
        return result, False
    result.stale, result.status = True, Status.NEEDS_REVIEW
    result.issues.append(issue("STATE_CHANGED"))
    if result.funding:
        for candidate in result.funding.candidates:
            candidate.validation = "STALE"
    _audit(ai.backend, result, now, "readiness_stale")
    return result, True


def _transient(result):
    if any(i.code in {"BACKEND_UNAVAILABLE", "BACKEND_CONTRACT_MISMATCH"} for i in result.issues):
        return True
    if result.funding:
        return bool(
            result.funding.issues
            or any(c.error_code for c in result.funding.calls)
            or any(p.validation == "PENDING" for p in result.funding.candidates)
        )
    return False
