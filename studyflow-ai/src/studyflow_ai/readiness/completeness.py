from collections import defaultdict

from studyflow_ai.models import Issue, Status
from studyflow_ai.readiness.models import CATEGORIES, CategoryCoverage, CompletenessResult


def issue(code, field=None, message=None):
    return Issue(code=code, field=field, message=message or code.replace("_", " ").lower())


def _cost_state(item):
    if item.applicability == "NOT_APPLICABLE":
        return "Known"
    if not item.currency or not item.period:
        return "Missing"
    if item.amount is not None:
        return "Estimated" if item.confidence_type == "INFERRED" else "Known"
    return "Estimated" if item.lower is not None and item.upper is not None else "Missing"


def _conflicts(items, profile):
    issues = []
    if len(items) > 1:
        comparable = [i for i in items if i.applicability == "APPLICABLE"]
        signatures = {
            (i.currency, i.amount, i.lower, i.upper, i.period, i.year, i.campus) for i in comparable
        }
        components = [i.component for i in items]
        distinct_components = all(components) and len(components) == len(set(components))
        if len(comparable) > 1 and not distinct_components:
            code = "POSSIBLE_DUPLICATE" if len(signatures) == 1 else "CONFLICTING_COST"
            issues.append(issue(code, items[0].category))
        if comparable and len(comparable) != len(items) and not distinct_components:
            issues.append(issue("APPLICABILITY_CONFLICT", items[0].category))
    for item in items:
        if item.applicability == "APPLICABLE" and item.year is None:
            issues.append(issue("MISSING_APPLICABLE_YEAR", item.cost_id))
        if item.campus and profile.campus and item.campus.casefold() != profile.campus.casefold():
            issues.append(issue("CAMPUS_MISMATCH", item.cost_id))
        if item.year and profile.start_date and item.year != profile.start_date.year:
            issues.append(issue("YEAR_MISMATCH", item.cost_id))
    return issues


def assess(draft):
    result = CompletenessResult(source_refs=[p.source_id for p in draft.provenance])
    grouped = defaultdict(list)
    for cost in draft.costs:
        grouped[cost.category].append(cost)
    for field in (
        "school",
        "campus",
        "country",
        "program",
        "student_type",
        "start_date",
        "end_date",
    ):
        if getattr(draft.profile, field) is None:
            result.issues.append(issue("MISSING_PROFILE_FIELD", field))
            result.questions.append(f"Confirm semester {field}.")
    for category in CATEGORIES:
        items = grouped[category]
        states = [_cost_state(i) for i in items]
        state = (
            "Missing"
            if not states or "Missing" in states
            else ("Estimated" if "Estimated" in states else "Known")
        )
        result.categories.append(
            CategoryCoverage(
                category=category,
                state=state,
                cost_ids=[i.cost_id for i in items],
                applicable=not items or any(i.applicability == "APPLICABLE" for i in items),
            )
        )
        if state == "Missing":
            result.issues.append(issue("MISSING_COST", category))
            result.questions.append(
                f"Provide {category} amount/range, currency and period, or confirm not applicable with a reason."
            )
        result.issues.extend(_conflicts(items, draft.profile))
    result.complete = not result.issues
    result.status = Status.READY if result.complete else Status.NEEDS_REVIEW
    return result
