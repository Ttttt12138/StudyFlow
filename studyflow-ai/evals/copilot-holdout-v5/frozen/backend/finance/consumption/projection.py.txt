from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings

from finance.readiness.budget import money, project
from finance.readiness.services import active

from .analysis import complete_months, cost_for, effective_draft, spending_rows
from .models import AccountCoverage, BalanceConfirmation, BankAccount, RecurringExpense


def project_for(owner, snapshot, draft, now, horizon=90, conditional=False):
    if not settings.STUDYFLOW_CONSUMPTION_ENABLED:
        return project(snapshot, draft, now, horizon, conditional)
    snapshot = confirmed_snapshot(owner, snapshot, now)
    calibrated, statistics = effective_draft(owner, draft, now)
    schedule_linked_costs(owner, calibrated, now, horizon)
    adjusted = observation_snapshot(owner, snapshot, calibrated, now)
    adjusted["events"].extend(recurring_events(owner, calibrated, now, horizon))
    result = project(adjusted, calibrated, now, horizon, conditional)
    result.update(
        analysis_version=active(owner).analysis_version, calibration=statistics
    )
    accounts = list(BankAccount.objects.filter(owner=owner))
    fresh_accounts = all(
        AccountCoverage.objects.filter(
            account=account, complete=True, end__gte=now - timedelta(days=7)
        ).exists()
        for account in accounts
    )
    stale_balance = date.fromisoformat(snapshot["as_of"]) < now - timedelta(days=7)
    gaps = []
    gaps.extend(
        "MISSING_PROFILE:" + field
        for field in ("school", "campus", "country", "program", "student_type")
        if not draft["profile"].get(field)
    )
    if stale_balance:
        gaps.append("BALANCE_SNAPSHOT_STALE")
    if not accounts or not fresh_accounts or not complete_months(owner, now):
        gaps.append("TRANSACTION_COVERAGE_INSUFFICIENT")
    if statistics["unresolved_transactions"]:
        gaps.append("TRANSACTIONS_NEED_REVIEW")
    from .models import ObservedTransaction

    if ObservedTransaction.objects.filter(
        owner=owner, date__gte=snapshot["as_of"], date__lt=now
    ).exists():
        gaps.append("BALANCE_PRECEDES_OBSERVATIONS")
    result["data_issues"] = gaps
    result["complete"] = result["complete"] and not gaps
    return result


def confirmed_snapshot(owner, snapshot, now):
    item = (
        BalanceConfirmation.objects.filter(owner=owner, as_of__lte=now)
        .order_by("-as_of", "-created_at")
        .first()
    )
    if item is None or item.as_of < date.fromisoformat(snapshot["as_of"]):
        return snapshot
    result = deepcopy(snapshot)
    result.update(opening_balance=money(item.amount), as_of=item.as_of.isoformat())
    result["events"] = [
        e
        for e in result["events"]
        if "settled_sequence" not in e or e["settled_sequence"] > item.ledger_sequence
    ]
    return result


def schedule_linked_costs(owner, draft, now, horizon):
    category_map = {
        "rent": "housing",
        "mobile": "communications",
        "utilities": "utilities",
        "transport": "transport",
        "subscription": "subscription",
    }
    candidates = {}
    for item in RecurringExpense.objects.filter(owner=owner, active=True).exclude(
        decision="ignored"
    ):
        if item.result.get("status") != "READY" and item.decision != "accepted":
            continue
        costs = (
            [c for c in draft["costs"] if c["cost_id"] == item.cost_id]
            if item.cost_id
            else [
                c
                for c in draft["costs"]
                if c["category"] == category_map.get(item.result["category"])
            ]
        )
        if len(costs) == 1 and costs[0].get("period") == "monthly":
            candidates.setdefault(costs[0]["cost_id"], []).append(item)
    for cost in draft["costs"]:
        patterns = candidates.get(cost["cost_id"], [])
        if len(patterns) != 1 or cost.get("applicability") == "NOT_APPLICABLE":
            continue
        item = patterns[0]
        locked = cost.get("locked") or cost.get("confidence_type") == "VERIFIED"
        if locked and not (
            item.decision == "accepted" and item.cost_id == cost["cost_id"]
        ):
            continue
        cost["forecast_schedule"] = [
            day
            for day in recurrence_dates(item.result, now, horizon)
            if draft["profile"]["start_date"] <= day <= draft["profile"]["end_date"]
        ]


def recurrence_dates(pattern, now, horizon):
    from studyflow_ai.recurring import next_date

    when = date.fromisoformat(pattern["expected_next_date"])
    day, dates = when.day, []
    end = now + timedelta(days=horizon - 1)
    while when <= end:
        if when >= now:
            dates.append(when.isoformat())
        when = next_date(
            when, day, "month_end=True" in pattern["basis"], when + timedelta(days=1)
        )
    return dates


def observation_snapshot(owner, snapshot, draft, now):
    from .analysis import covered

    adjusted = deepcopy(snapshot)
    scopes = list(AccountCoverage.objects.filter(owner=owner, complete=True))
    accounts = set(BankAccount.objects.filter(owner=owner).values_list("id", flat=True))
    rows = spending_rows(owner, now)
    by_cost = {}
    for tx in rows:
        cost = cost_for(tx, draft["costs"])
        if cost and cost["period"] == "monthly":
            by_cost.setdefault(cost["cost_id"], []).append(tx)
    events = []
    for event in adjusted["events"]:
        if not event["id"].startswith("cost:") or "settled_sequence" in event:
            events.append(event)
            continue
        key = event["id"].split(":")[1]
        day = date.fromisoformat(event["date"])
        cost = next((c for c in draft["costs"] if c["cost_id"] == key), None)
        if cost and cost.get("period") == "monthly" and day >= now:
            continue  # Regenerate future estimates at the calibrated rate.
        if (
            key in by_cost
            and day < now
            and accounts
            and all(covered(a, day, day, scopes) for a in accounts)
        ):
            continue  # Historical consumption is reported as Actual, not a new unpaid bill.
        events.append(event)
    adjusted["events"] = events
    # project() would otherwise regenerate historical estimates that were removed above.
    draft["profile"]["start_date"] = max(
        draft["profile"]["start_date"], now.isoformat()
    )
    return adjusted


def recurring_events(owner, draft, now, horizon):
    from studyflow_ai.recurring import next_date

    result = []
    end = now + timedelta(days=horizon - 1)
    category_map = {
        "rent": "housing",
        "mobile": "communications",
        "utilities": "utilities",
        "transport": "transport",
        "subscription": "subscription",
    }
    for item in RecurringExpense.objects.filter(owner=owner, active=True).exclude(
        decision="ignored"
    ):
        pattern = item.result
        if pattern.get("status") != "READY" and item.decision != "accepted":
            continue
        category = category_map.get(pattern["category"])
        if item.cost_id or any(c["category"] == category for c in draft["costs"]):
            continue
        when = date.fromisoformat(pattern["expected_next_date"])
        day = when.day
        while when <= end:
            if when >= now:
                result.append(
                    {
                        "id": f"recurring:{item.id}:{when}",
                        "kind": "expense",
                        "label": pattern["counterparty"],
                        "amount": pattern["amount"],
                        "date": when.isoformat(),
                        "certainty": "estimated",
                    }
                )
            when = next_date(
                when,
                day,
                "month_end=True" in pattern["basis"],
                when + timedelta(days=1),
            )
    return result


def budget_overlay(owner, snapshot, draft, now, baseline):
    horizon = max(1, (date.fromisoformat(draft["profile"]["end_date"]) - now).days + 1)
    prediction = project_for(owner, snapshot, draft, now, horizon)
    result = deepcopy(baseline)
    result["original_budget"] = {
        k: baseline[k] for k in ("low", "base", "high", "remaining_base", "gap")
    }
    result["calibration"] = prediction["calibration"]
    result["analysis_version"] = prediction["analysis_version"]
    known_actual = sum(
        (
            Decimal(amount)
            for amount in prediction["calibration"]["category_actuals"].values()
        ),
        Decimal(0),
    )
    future = sum(
        (
            Decimal(e["amount"])
            for e in prediction["timeline"]
            if e["kind"] == "expense" and "settled_sequence" not in e
        ),
        Decimal(0),
    )
    result["observed_actual"] = money(known_actual)
    result["remaining_forecast"] = money(future)
    result["observed_plus_remaining"] = money(known_actual + future)
    result["gap"] = prediction["maximum_reserve_gap"]
    result["complete"] = baseline["complete"] and prediction["complete"]
    result["sufficient"] = result["complete"] and Decimal(result["gap"]) == 0
    result["issues"] = sorted(set(result["issues"] + prediction.get("data_issues", [])))
    return result
