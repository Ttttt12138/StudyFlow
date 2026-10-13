"""Catalog estimates count actual periods; missing amounts remain visible."""
from decimal import Decimal

from finance.readiness.budget import money

REQUIRED = {"tuition", "housing", "food", "insurance", "visa", "transport", "travel", "study_materials"}
LIVING = {"housing", "food", "transport", "communications"}


def duration(entry, years=None):
    normal = years is None or years == entry.school.duration_years
    months = entry.school.duration_months if normal else None
    months = months or (years or entry.school.duration_years or 1) * 12
    semesters = entry.school.total_semesters if normal else None
    semesters = semesters or int(Decimal(months * entry.calendar.semesters_per_year) / 12)
    return months, semesters


def occurrences(entry, cost, years=None):
    months, semesters = duration(entry, years)
    if months <= cost.start_month:
        return 0
    return {"once": 1, "semester": semesters, "month": months,
            "year": (months + 11) // 12}[cost.period]


def period_amount(entry, cost, index):
    if not cost.year_amounts:
        return cost.typical()
    frequency = {"once": 1, "semester": entry.calendar.semesters_per_year, "month": 12, "year": 1}
    year = index // frequency[cost.period]
    return Decimal(cost.year_amounts[min(year, len(cost.year_amounts) - 1)])


def line(entry, cost, years=None):
    count = occurrences(entry, cost, years)
    per_year = {"once": 1, "semester": entry.calendar.semesters_per_year, "month": 12, "year": 1}[cost.period]
    group = "tuition" if cost.category == "tuition" else "living" if cost.category in LIVING else "essentials"
    row = {"cost_id": cost.cost_id, "category": cost.category, "group": group,
           "label": cost.label.model_dump(), "period": cost.period, "occurrences": count,
           "amount": None, "total": None, "per_year": None, "lower": cost.lower, "upper": cost.upper,
           "start_month": cost.start_month,
           "estimate": cost.estimate, "source_url": str(cost.source_url) if cost.source_url else None,
           "quote": cost.quote, "observed_at": entry.observed_at.isoformat(),
           "status": cost.status or ("estimated" if cost.estimate else "known")}
    if cost.status == "missing":
        return row
    base = sum((period_amount(entry, cost, n) for n in range(count)), Decimal(0))
    if cost.course_total is not None:
        base = Decimal(cost.course_total) * count / occurrences(entry, cost)
    low = Decimal(cost.lower) * count if cost.lower is not None else base
    high = Decimal(cost.upper) * count if cost.upper is not None else base
    first = sum((period_amount(entry, cost, n) for n in range(min(count, per_year))), Decimal(0))
    if cost.course_total is not None:
        first = Decimal(cost.course_total) * min(count, per_year) / occurrences(entry, cost)
    if cost.start_month >= 12:
        first = Decimal(0)
    amounts = [money(period_amount(entry, cost, n)) for n in range(count)]
    if cost.course_total is not None:
        amounts = [money(Decimal(money(base * (n + 1) / count)) - Decimal(money(base * n / count))) for n in range(count)]
    return {**row, "amount": money(cost.typical()), "total": money(base), "per_year": money(first),
            "period_amounts": amounts,
            "total_low": money(low), "total_high": money(high)}


def declared_entry(entry, inputs):
    """Personal edits never mutate the catalog or a confirmed plan snapshot."""
    from finance.workflow_common import require
    changes = {r["cost_id"]: r for r in inputs.get("costs", [])}
    require(set(changes) <= {c.cost_id for c in entry.costs}, "UNKNOWN_PLANNING_COST")
    revised = entry.model_copy(deep=True)
    for cost in revised.costs:
        change = changes.get(cost.cost_id, {})
        if "amount" not in change:
            continue
        cost.amount = change["amount"]
        cost.lower = cost.upper = cost.course_total = None
        cost.year_amounts = []
        cost.status = "missing" if change["amount"] is None else "estimated"
        cost.estimate = True
        cost.quote = "User-declared planning amount; original catalog source is retained for comparison."
    return revised


def estimate(entry, years=None):
    rows = [line(entry, c, years) for c in entry.costs]
    known = [r for r in rows if r["total"] is not None]
    missing = [r["cost_id"] for r in rows if r["total"] is None]
    missing += sorted(REQUIRED - {c.category for c in entry.costs})
    total = sum((Decimal(r["total"]) for r in known), Decimal(0))
    months, semesters = duration(entry, years)
    return {"school_key": entry.key, "catalog_version": entry.version, "currency": entry.school.currency,
            "program": entry.school.program.model_dump(),
            "years": months / 12, "duration_months": months, "total_semesters": semesters,
            "lines": rows, "groups": {g: money(sum((Decimal(r["total"]) for r in known
              if r["group"] == g), Decimal(0))) for g in ("tuition", "living", "essentials")},
            "first_year": money(sum((Decimal(r["per_year"]) for r in known), Decimal(0))),
            "total": money(total), "known_subtotal": money(total),
            "total_low": money(sum((Decimal(r["total_low"]) for r in known), Decimal(0))),
            "total_high": money(sum((Decimal(r["total_high"]) for r in known), Decimal(0))),
            "estimated_share": money(sum((Decimal(r["total"]) for r in known if r["estimate"]), Decimal(0))
                                     / total * 100 if total else 0),
            "complete": not missing, "missing_cost_ids": missing,
            "observed_at": entry.observed_at.isoformat(), "sample": True}
