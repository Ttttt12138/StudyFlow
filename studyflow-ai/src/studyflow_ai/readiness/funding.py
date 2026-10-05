from decimal import Decimal

from pydantic import ValidationError

from studyflow_ai.models import Status
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.readiness.completeness import issue
from studyflow_ai.readiness.models import (
    Allocation,
    FundingCandidate,
    FundingResult,
    LoanExplanation,
    MoneyValue,
)


def loan_explanation(quote):
    message = {
        "AFFORDABLE": "B reports affordability under its supplied assumptions; confirm all conditions.",
        "UNAFFORDABLE": "B reports repayment pressure; do not present this loan as affordable.",
        "INSUFFICIENT_DATA": "无法判断还款能力：缺少收入、生活支出或贷款条款。",
    }[quote.affordability]
    if quote.missing_inputs:
        message = "无法判断还款能力：" + ", ".join(quote.missing_inputs)
    return LoanExplanation(quote=quote.model_copy(deep=True), message=message)


def check_allocations(candidate, context):
    issues, seen = [], set()
    sources = {s.funding_id: s for s in context.sources}
    allowed = set(sources) | {q.quote_id for q in context.loan_quotes}
    if not set(candidate.source_refs).issubset(allowed):
        issues.append(issue("UNKNOWN_REFERENCE"))
    for allocation in candidate.allocations:
        source = sources.get(allocation.funding_id)
        if not source or allocation.funding_id in seen:
            issues.append(issue("UNKNOWN_OR_DUPLICATE_ALLOCATION"))
            continue
        seen.add(allocation.funding_id)
        if allocation.funding_id not in candidate.source_refs:
            issues.append(issue("MISSING_FUNDING_REFERENCE"))
        if (
            allocation.amount.currency != source.allocatable.currency
            or not Decimal("0") < allocation.amount.amount <= source.allocatable.amount
        ):
            issues.append(issue("INVALID_ALLOCATION_AMOUNT"))
        if source.received:
            issues.append(issue("FUNDS_ALREADY_IN_BALANCE"))
        if source.loan_quote_id and source.loan_quote_id not in candidate.source_refs:
            issues.append(issue("MISSING_LOAN_REFERENCE"))
        candidate.conditions.extend(source.conditions)
        if source.available_date is None:
            candidate.conditions.append("Funding availability date must be confirmed.")
    candidate.conditions = list(dict.fromkeys(candidate.conditions))
    candidate.conditions.append(
        "Only receipt recorded by B changes available funds; approval is not receipt."
    )
    return issues


class FundingPlanner:
    def __init__(self, provider, backend=None):
        self.provider, self.backend = provider, backend

    def generate(self, context):
        result = FundingResult(
            state_version=context.budget.state_version,
            budget_version=context.budget.budget_version,
            source_refs=[s.funding_id for s in context.sources],
        )
        result.loan_explanations = [loan_explanation(q) for q in context.loan_quotes]
        result.applications = [a.model_copy(deep=True) for a in context.applications]
        result.application_notes = [
            f"{a.application_id}: {a.state} (SIMULATED). Approval does not change funds; B owns all transitions."
            for a in context.applications
        ]
        try:
            raw, record = self.provider.plan(context)
            result.calls.append(record)
            for item in raw.candidates:
                self._candidate(item, context, result)
            if not raw.candidates:
                result.issues.append(issue("NO_CANDIDATE_PLAN"))
        except ProviderFailure as exc:
            result.calls.append(exc.record)
            result.issues.append(issue(exc.code))
        if result.issues or any(p.validation != "VALID" for p in result.candidates):
            result.status = Status.NEEDS_REVIEW
        return result

    def _candidate(self, raw, context, result):
        try:
            candidate = FundingCandidate(
                allocations=[
                    Allocation(
                        funding_id=a.funding_id,
                        amount=MoneyValue(currency=a.currency, amount=a.amount),
                    )
                    for a in raw.allocations
                ],
                source_refs=raw.source_refs,
                conditions=raw.conditions,
                explanation=raw.explanation,
            )
            candidate.issues.extend(check_allocations(candidate, context))
            if candidate.issues:
                candidate.validation = "INVALID"
            elif self.backend:
                try:
                    candidate = self.backend.validate_funding(candidate, context)
                except (ConnectionError, TimeoutError):
                    candidate.issues.append(issue("BACKEND_VALIDATION_UNAVAILABLE"))
            result.candidates.append(candidate)
        except (ValidationError, ValueError):
            result.issues.append(issue("INVALID_CANDIDATE"))
