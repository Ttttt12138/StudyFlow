"""Read-only projections of user-declared funds through the existing cashflow engine."""
from datetime import date, timedelta

from finance.calculations import forecast
from finance.lending_core.calculations import month_date
from finance.workflow_common import require

from . import costs, services


def thb(value, currency, issues, key):
    if value is None:
        issues.append("MISSING:" + key)
        return None
    converted = services.convert(value, currency, "THB")
    if converted is None:
        issues.append("FX_REQUIRED:" + key)
        return None
    return converted["amount"]


def payment_events(entry, inputs, issues, years=None, start_date=None):
    start = start_date or entry.calendar.start_date
    overrides = {r["cost_id"]: r for r in inputs.get("costs", [])}
    require(set(overrides) <= {c.cost_id for c in entry.costs}, "UNKNOWN_PLANNING_COST")
    events = []
    for cost in entry.costs:
        change = overrides.get(cost.cost_id, {})
        if change.get("paid"):
            continue
        anchor = change.get("due_date") or (cost.due_date.isoformat() if cost.due_date else inputs.get("payment_date"))
        if cost.period == "month":
            anchor = change.get("due_date") or start.isoformat()
        step = {"once": 0, "month": 1, "semester": 12 // entry.calendar.semesters_per_year, "year": 12}[cost.period]
        amounts = costs.line(entry, cost, years).get("period_amounts", [])
        for index in range(costs.occurrences(entry, cost, years)):
            value = change.get("amount") if "amount" in change else (
                None if cost.status == "missing" else costs.period_amount(entry, cost, index))
            if cost.course_total is not None and "amount" not in change:
                value = amounts[index]
            offset = index * step + (0 if change.get("due_date") or cost.due_date else cost.start_month)
            when = month_date(date.fromisoformat(anchor), offset).isoformat() if anchor else None
            events.append({"id": f"cost:{cost.cost_id}:{index}", "label": cost.label.model_dump(),
                           "kind": "expense", "amount": thb(value, entry.school.currency, issues, cost.cost_id),
                           "date": max(when, inputs["as_of"]) if when else None,
                           "certainty": "estimated", "source_url": str(cost.source_url) if cost.source_url else None})
    return events


def support_events(inputs, issues):
    result = []
    for item in inputs["supports"]:
        if item.get("included_in_funds"):
            continue
        when = item["available_on"]
        if when and when < inputs["as_of"]:
            issues.append("SUPPORT_DATE_PAST:" + item["id"])
        result.append({"id": "support:" + item["id"], "label": item["id"], "kind": "income",
                       "amount": thb(item["amount"], item["currency"], issues, item["id"]),
                       "date": max(when, inputs["as_of"]) if when else None,
                       "certainty": "confirmed" if item["confirmed"] else "estimated"})
    return result


def projections(entry, inputs, years=None, start_date=None):
    issues = []
    opening = thb(inputs["available_funds"], inputs["funds_currency"], issues, "available_funds")
    reserve = thb(inputs["reserve"], inputs["funds_currency"], issues, "reserve")
    events = payment_events(entry, inputs, issues, years, start_date) + support_events(inputs, issues)
    estimate = services.estimate(entry, years)
    overridden = {c["cost_id"] for c in inputs.get("costs", []) if c.get("amount") is not None}
    issues += ["MISSING:" + key for key in estimate["missing_cost_ids"] if key not in overridden]
    result = {}
    for conditional in (False, True):
        selected = [e for e in events if conditional or e["kind"] != "income" or e["certainty"] == "confirmed"]
        snapshot = {"as_of": inputs["as_of"], "opening_balance": opening or "0.00",
                    "reserve": reserve or "0.00", "events": selected}
        end = date.fromisoformat(inputs["as_of"]) + timedelta(days=inputs["horizon"] - 1)
        value = forecast(snapshot, end, include_estimates=True)
        missing = sorted(set(issues + ["DATE_OR_AMOUNT_MISSING:" + k for k in value["missing_event_ids"]]))
        value.update(complete=not missing, issues=missing, horizon=inputs["horizon"],
                     as_of=inputs["as_of"], conditional=conditional, declared_funds=True)
        result["conditional_forecast" if conditional else "forecast"] = value
    result["suggested_principal"] = (result["forecast"]["maximum_reserve_gap"]
                                     if result["forecast"]["complete"] else None)
    return result
