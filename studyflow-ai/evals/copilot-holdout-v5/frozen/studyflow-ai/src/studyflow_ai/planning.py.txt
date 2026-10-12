from pydantic import ValidationError

from studyflow_ai.models import CandidatePlan, PlanningContext, PlanResult, Status
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.validation import issue

PREREQUISITES = {
    "family_support": [
        "Sponsor agreement required",
        "Funds must actually arrive before use",
        "Reforecast and obtain payment authorization after receipt",
    ],
    "installment": ["School must confirm installment eligibility and schedule"],
    "reduce_spending": [
        "Verified reducible spending must cover the required amount before the deadline"
    ],
}


class Planner:
    def __init__(self, language_model, backend=None):
        self.language_model, self.backend = language_model, backend

    def generate_plans(self, context: PlanningContext) -> PlanResult:
        result = PlanResult(
            state_version=context.snapshot.state_version,
            source_refs=[context.risk.risk_id, *context.risk.source_refs],
        )
        if context.now.date() > context.risk.due_date:
            result.issues.append(issue("DEADLINE_PASSED"))
        else:
            self._generate(context, result)
        if result.issues or any(p.validation != "VALID" for p in result.plans):
            result.status = Status.NEEDS_REVIEW
        return result

    def _generate(self, context, result):
        try:
            proposals, record = self.language_model.plan(context)
            result.calls.append(record)
            if len(proposals.plans) > 3:
                result.issues.append(issue("TOO_MANY_PLANS"))
                return
            for raw in proposals.plans:
                self._candidate(raw, context, result)
            if not proposals.plans:
                result.issues.append(issue("NO_CANDIDATE_PLAN"))
        except ProviderFailure as exc:
            result.calls.append(exc.record)
            result.issues.append(issue(exc.code))

    def _candidate(self, raw, context, result):
        try:
            plan = CandidatePlan.model_validate(raw.model_dump())
        except ValidationError:
            result.issues.append(issue("INVALID_PLAN_STRUCTURE"))
            return
        plan.prerequisites = list(dict.fromkeys([*plan.prerequisites, *PREREQUISITES[plan.kind]]))
        plan.issues.extend(check_candidate(plan, context))
        if plan.issues:
            plan.validation = "INVALID"
        elif self.backend is not None:
            try:
                plan = self.backend.validate_plan(plan, context)
            except (ConnectionError, TimeoutError):
                plan.issues.append(issue("BACKEND_VALIDATION_UNAVAILABLE"))
        result.plans.append(plan)


def check_candidate(plan, context):
    issues = []
    allowed = {
        context.risk.risk_id,
        *context.risk.source_refs,
        *(item.obligation_id for item in context.snapshot.obligations),
    }
    if not set(plan.source_refs).issubset(allowed):
        issues.append(issue("UNKNOWN_REFERENCE"))
    if plan.required_funding <= 0 or plan.required_funding != context.forecast.funding_target:
        issues.append(issue("FUNDING_TARGET_MISMATCH"))
    if any(not context.now.date() <= step.by_date <= context.risk.due_date for step in plan.steps):
        issues.append(issue("INVALID_PLAN_DATE"))
    return issues
