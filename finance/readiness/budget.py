"""Exact THB budget arithmetic and a dated view of the existing cashflow engine."""

import calendar
from copy import deepcopy
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from finance.calculations import forecast

ZERO = Decimal(0)
CENT = Decimal(".01")


def money(value):
    return format(Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP), ".2f")


def dates(start, end):
    for offset in range((end - start).days + 1):
        yield start + timedelta(days=offset)


def bounds(item):
    value = item.get("amount")
    low = item.get("lower") if item.get("lower") is not None else value
    high = item.get("upper") if item.get("upper") is not None else value
    if low is None or high is None:
        return None
    low, high = Decimal(low), Decimal(high)
    return low, Decimal(value) if value is not None else (low + high) / 2, high


def portions(item, profile):
    start, end = (date.fromisoformat(profile[k]) for k in ("start_date", "end_date"))
    if item.get("period") == "monthly":
        return [
            (day, Decimal(1) / calendar.monthrange(day.year, day.month)[1])
            for day in dates(start, end)
        ]
    when = item.get("due_date")
    if item.get("period") in {"once", "semester", "yearly"}:
        return [(date.fromisoformat(when) if when else None, Decimal(1))]
    return []


def cost_events(item, profile, amount):
    if "forecast_schedule" in item and not item.get("paid"):
        return [
            {
                "id": "cost:" + item["cost_id"] + ":" + day,
                "label": item["category"],
                "kind": "expense",
                "amount": money(amount),
                "date": day,
                "certainty": "estimated",
                "source_type": "inferred_monthly_schedule",
            }
            for day in item["forecast_schedule"]
        ]
    rows = portions(item, profile)
    if item.get("paid") or not rows or any(day is None for day, _ in rows):
        return []
    # Round cumulative totals, so splitting an expense never manufactures cents.
    cumulative, previous, result = ZERO, ZERO, []
    for day, fraction in rows:
        cumulative += amount * fraction
        rounded = Decimal(money(cumulative))
        result.append(
            {
                "id": "cost:" + item["cost_id"] + ":" + day.isoformat(),
                "label": item["category"],
                "kind": "expense",
                "amount": money(rounded - previous),
                "date": day.isoformat(),
                "certainty": "confirmed"
                if item.get("confidence_type") == "VERIFIED"
                and item.get("amount") is not None
                else "estimated",
            }
        )
        if item.get("beneficiary_id"):
            result[-1]["beneficiary_id"] = item["beneficiary_id"]
        previous = rounded
    return result


def item_issues(item, as_of):
    issues = []
    if item.get("fx_issue"):
        issues.append(item["fx_issue"] + ":" + item["cost_id"])
    if item.get("conflict"):
        issues.append("CONFLICT:" + item["cost_id"])
    if item.get("valid_until") and date.fromisoformat(item["valid_until"]) < as_of:
        issues.append("EXPIRED_SOURCE:" + item["cost_id"])
    if item.get("paid") is None:
        issues.append("PAYMENT_STATUS_MISSING:" + item["cost_id"])
    if item.get("currency") != "THB":
        issues.append("FX_REQUIRED:" + item["cost_id"])
    return issues


def calculate(draft, opening, as_of=None):
    as_of = as_of or date.fromisoformat(draft["profile"]["start_date"])
    reserve = draft.get("reserve")
    totals, remaining, events, issues = [ZERO] * 3, [ZERO] * 3, [], []
    if reserve is None:
        issues.append("RESERVE_NOT_CONFIRMED")
    categories = {c["category"] for c in draft["costs"]}
    issues += [
        "MISSING:" + c
        for c in draft.get("required_categories", [])
        if c not in categories
    ]
    components = [
        c.get("component") or c["category"]
        for c in draft["costs"]
        if c.get("applicability") != "NOT_APPLICABLE"
    ]
    issues += [
        "DUPLICATE_COMPONENT:" + key
        for key in set(components)
        if components.count(key) > 1
    ]
    for item in draft["costs"]:
        if item.get("applicability") == "NOT_APPLICABLE":
            continue
        issues.extend(item_issues(item, as_of))
        profile = draft["profile"]
        if (
            item.get("year")
            and item["year"] != date.fromisoformat(profile["start_date"]).year
        ):
            issues.append("YEAR_MISMATCH:" + item["cost_id"])
        if (
            item.get("campus")
            and profile.get("campus")
            and item["campus"].casefold() != profile["campus"].casefold()
        ):
            issues.append("CAMPUS_MISMATCH:" + item["cost_id"])
        values, periods = bounds(item), portions(item, draft["profile"])
        if values is None or not periods or item.get("currency") != "THB":
            issues.append("MISSING:" + item["cost_id"])
            continue
        if any(day is None for day, _ in periods) and not item.get("paid"):
            issues.append("DATE_MISSING:" + item["cost_id"])
        fraction = sum((part for _, part in periods), ZERO)
        for index, value in enumerate(values):
            amount = Decimal(money(value * fraction))
            totals[index] += amount
            if not item.get("paid"):
                remaining[index] += amount
        events.extend(cost_events(item, draft["profile"], values[1]))
    reserve = Decimal(reserve or "0")
    gap = max(ZERO, remaining[1] + reserve - Decimal(opening))
    return {
        "low": money(totals[0] + reserve),
        "base": money(totals[1] + reserve),
        "high": money(totals[2] + reserve),
        "remaining_base": money(remaining[1] + reserve),
        "gap": money(gap),
        "complete": not issues,
        "sufficient": not issues and gap == 0,
        "currency": "THB",
        "issues": sorted(set(issues)),
        "events": events,
        "assumptions": [
            "Monthly living costs are prorated by calendar days; range midpoint is the base unless supplied.",
            "Reserve is a balance floor, not spending; no deposit refund is assumed.",
        ],
    }


def forward_snapshot(snapshot, now):
    result = deepcopy(snapshot)
    balance = Decimal(result["opening_balance"])
    future = []
    for event in result["events"]:
        when = date.fromisoformat(event["date"]) if event["date"] else None
        if when and when < now and "settled_sequence" in event:
            value = Decimal(event["amount"])
            balance += value if event["kind"] == "income" else -value
        else:
            if when and when < now:
                event["date"] = (
                    now.isoformat()
                )  # Unpaid overdue obligations remain due.
            future.append(event)
    result.update(as_of=now.isoformat(), opening_balance=money(balance), events=future)
    return result


def project(snapshot, draft, now, horizon=90, conditional=False):
    result = forward_snapshot(snapshot, now)
    budget = calculate(draft, result["opening_balance"], now)
    result["reserve"] = draft.get("reserve") or "0.00"
    existing = {event["id"] for event in snapshot["events"]}
    for event in budget["events"]:
        if event["id"] not in existing:
            event = dict(event)
            event["date"] = max(event["date"], now.isoformat())
            result["events"].append(event)
    excluded = [
        e["id"]
        for e in result["events"]
        if e["kind"] == "income" and e["certainty"] != "confirmed"
    ]
    if not conditional:
        result["events"] = [e for e in result["events"] if e["id"] not in excluded]
    output = forecast(result, now + timedelta(days=horizon - 1), include_estimates=True)
    output.update(
        daily=daily_balances(result, output, now, horizon),
        budget_issues=budget["issues"],
        excluded_unconfirmed_income=excluded,
        conditional=conditional,
    )
    output["monthly"] = monthly_balances(output["daily"])
    output["complete"] = budget["complete"] and not output["missing_event_ids"]
    return output


def daily_balances(snapshot, output, now, horizon):
    balance, by_day = snapshot["opening_balance"], {}
    for event in output["timeline"]:
        by_day.setdefault(event["date"], []).append(event["balance_after"])
    rows = []
    for day in dates(now, now + timedelta(days=horizon - 1)):
        changes = by_day.get(day.isoformat(), [])
        minimum = min(Decimal(value) for value in [balance, *changes])
        balance = changes[-1] if changes else balance
        rows.append(
            {
                "date": day.isoformat(),
                "balance": balance,
                "minimum_balance": money(minimum),
                "reserve_gap": money(max(ZERO, Decimal(snapshot["reserve"]) - minimum)),
            }
        )
    return rows


def monthly_balances(rows):
    months = {}
    for row in rows:
        key = row["date"][:7]
        item = months.setdefault(
            key,
            {
                "month": key,
                "ending_balance": row["balance"],
                "minimum_balance": row["minimum_balance"],
            },
        )
        item["ending_balance"] = row["balance"]
        item["minimum_balance"] = money(
            min(Decimal(item["minimum_balance"]), Decimal(row["minimum_balance"]))
        )
    return list(months.values())
