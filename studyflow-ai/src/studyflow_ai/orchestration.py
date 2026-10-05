import hashlib
from datetime import datetime
from zoneinfo import ZoneInfo

from studyflow_ai.models import AuditEvent, CheckResult, RouteContext, Status
from studyflow_ai.planning import Planner
from studyflow_ai.privacy import redact
from studyflow_ai.routing import Router

BANGKOK = ZoneInfo("Asia/Bangkok")


class CheckInProgress(RuntimeError):
    pass


def check_key(snapshot, forecast, now):
    identity = (
        snapshot.student_id,
        snapshot.state_version,
        tuple(sorted(r.risk_id for r in forecast.risks)),
        now.date().isoformat(),
    )
    return hashlib.sha256(repr(identity).encode()).hexdigest()


class StudyFlow:
    def __init__(self, backend, classifier, language_model):
        self.backend = backend
        self.router = Router(classifier)
        self.planner = Planner(language_model, backend)

    def run_check(self, student_id, trigger, now: datetime) -> CheckResult:
        if now.tzinfo is None:
            raise ValueError("now must be timezone-aware")
        now = now.astimezone(BANGKOK)
        for _ in range(2):
            result = self._attempt(student_id, trigger, now)
            if not result.stale:
                return result
        return result

    def _attempt(self, student_id, trigger, now):
        snapshot = self.backend.read_state(student_id)
        forecast = self.backend.forecast(snapshot, now)
        if forecast.state_version != snapshot.state_version:
            raise ValueError("Backend forecast must match snapshot version")
        key = check_key(snapshot, forecast, now)
        cached = self.backend.get_check(key)
        if cached:
            return cached.model_copy(update={"reused": True}, deep=True)
        if not self.backend.claim_check(key):
            raise CheckInProgress("A check for this snapshot and date is already running")
        try:
            result = self._evaluate(snapshot, forecast, now)
            return self._save(key, result, trigger)
        finally:
            self.backend.release_check(key)

    def _evaluate(self, snapshot, forecast, now):
        result = CheckResult(
            state_version=snapshot.state_version,
            checked_at=now,
            risks=forecast.risks,
            source_refs=sorted({ref for risk in forecast.risks for ref in risk.source_refs}),
        )
        for risk in forecast.risks:
            context = RouteContext(
                text=risk.model_dump_json(),
                deterministic_risk=True,
                state_version=snapshot.state_version,
                source_refs=risk.source_refs,
            )
            result.routes.append(self.router.route(context))
            planning = self.backend.planning_context(snapshot, forecast, risk, now)
            result.planning.append(self.planner.generate_plans(planning))
        if any(plan.status != Status.READY for plan in result.planning):
            result.status = Status.NEEDS_REVIEW
        return result

    def _save(self, key, result, trigger):
        records = [c for r in result.routes for c in r.calls]
        records.extend(c for p in result.planning for c in p.calls)
        if any(c.error_code for c in records) or any(
            i.code == "BACKEND_VALIDATION_UNAVAILABLE"
            for p in result.planning
            for plan in p.plans
            for i in plan.issues
        ):
            self.backend.audit(
                AuditEvent(
                    trace_id=result.trace_id,
                    event="check_failed",
                    timestamp=result.checked_at,
                    state_version=result.state_version,
                    source_refs=result.source_refs,
                    details=redact(result.model_dump(mode="json")),
                )
            )
            return result
        if not self.backend.save_check(key, result):
            result.stale, result.status = True, Status.NEEDS_REVIEW
            for batch in result.planning:
                for plan in batch.plans:
                    plan.validation = "STALE"
            self.backend.audit(
                AuditEvent(
                    trace_id=result.trace_id,
                    event="check_stale",
                    timestamp=result.checked_at,
                    state_version=result.state_version,
                    source_refs=result.source_refs,
                    details={"trigger": trigger},
                )
            )
        return result

    def on_import(self, student_id, result, now):
        if result.status != Status.READY:
            raise ValueError("Import requires review before state update")
        self.backend.accept_import(student_id, result)
        return self.run_check(student_id, "import", now)
