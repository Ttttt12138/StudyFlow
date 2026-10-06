"""Deterministic observation statistics; no financial ledger writes."""

import calendar
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
from statistics import median

from studyflow_ai.models import Transaction
from studyflow_ai.recurring import detect_recurring, normalized

from finance.readiness.budget import money
from finance.readiness.services import active, business_date
from finance.workflow_common import owned, record, require

from .models import (
    AccountCoverage,
    BankAccount,
    CalibrationRevision,
    ObservedTransaction,
    RecurringExpense,
)

MAPPING = {
    "Rent": "housing",
    "Food": "food",
    "Transport": "transport",
    "Mobile": "communications",
    "Utilities": "utilities",
    "Subscription": "subscription",
}
ADJUSTABLE = {"food", "transport", "communications", "utilities"}


def complete_months(owner, now):
    accounts = list(BankAccount.objects.filter(owner=owner))
    coverage = list(AccountCoverage.objects.filter(owner=owner, complete=True))
    months = []
    for offset in range(1, 4):
        index = now.year * 12 + now.month - 1 - offset
        start = date(index // 12, index % 12 + 1, 1)
        end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
        if accounts and all(covered(c.id, start, end, coverage) for c in accounts):
            months.append((start, end))
    return months


def covered(account_id, start, end, scopes):
    cursor = start
    for scope in sorted(
        (s for s in scopes if s.account_id == account_id), key=lambda s: s.start
    ):
        if scope.start > cursor:
            break
        if scope.end >= cursor:
            cursor = scope.end + timedelta(days=1)
        if cursor > end:
            return True
    return False


def spending_rows(owner, now):
    return list(
        ObservedTransaction.objects.filter(
            owner=owner, date__lt=now, needs_review=False
        ).select_related("refund_of", "batch", "account")
    )


def cost_for(tx, costs):
    source = tx.refund_of if tx.category == "Refund" else tx
    if source is None or source.category not in MAPPING:
        return None
    if source.cost_id:
        return next((c for c in costs if c["cost_id"] == source.cost_id), None)
    candidates = [
        c
        for c in costs
        if c["category"] == MAPPING[source.category]
        and c.get("applicability") != "NOT_APPLICABLE"
    ]
    return candidates[0] if len(candidates) == 1 else None


def analyze(owner, draft=None, now=None):
    semester, now = active(owner), now or business_date(owner)
    draft = draft or semester.draft
    rows, months = spending_rows(owner, now), complete_months(owner, now)
    output = []
    for cost in draft["costs"]:
        relevant = [
            tx
            for tx in rows
            if (cost_for(tx, draft["costs"]) or {}).get("cost_id") == cost["cost_id"]
        ]
        output.append(cost_statistics(cost, relevant, months, draft, now))
    unresolved = ObservedTransaction.objects.filter(
        owner=owner, date__lt=now, needs_review=True
    ).exists()
    return {
        "analysis_version": semester.analysis_version,
        "budget_version": semester.version,
        "as_of": now.isoformat(),
        "rule_version": "monthly-median-1",
        "costs": output,
        "category_actuals": category_actuals(rows, draft["profile"]["start_date"]),
        "complete_months": [start.strftime("%Y-%m") for start, _ in months],
        "unresolved_transactions": unresolved,
        "is_simulated": True,
        "balance_basis": "DECLARED_OR_SIMULATED_LEDGER_NOT_CSV",
    }


def category_actuals(rows, start):
    totals = {}
    for tx in rows:
        if tx.date < date.fromisoformat(start) or tx.category in {"Transfer", "Income"}:
            continue
        category = (
            tx.refund_of.category
            if tx.category == "Refund" and tx.refund_of
            else tx.category
        )
        totals[category] = totals.get(category, Decimal(0)) - tx.amount
    return {key: money(max(Decimal(0), value)) for key, value in totals.items()}


def cost_statistics(cost, rows, months, draft, now):
    monthly = [
        max(
            Decimal(0),
            -sum((t.amount for t in rows if start <= t.date <= end), Decimal(0)),
        )
        for start, end in months
    ]
    observed = money(
        max(
            Decimal(0),
            -sum(
                (
                    t.amount
                    for t in rows
                    if date.fromisoformat(draft["profile"]["start_date"])
                    <= t.date
                    < now
                ),
                Decimal(0),
            ),
        )
    )
    locked = (
        cost.get("locked")
        or cost.get("confidence_type") == "VERIFIED"
        or cost["category"] not in ADJUSTABLE
    )
    eligible = (
        bool(months)
        and not locked
        and cost.get("period") == "monthly"
        and cost.get("applicability") != "NOT_APPLICABLE"
    )
    proposed = money(median(monthly)) if monthly else None
    return {
        "cost_id": cost["cost_id"],
        "category": cost["category"],
        "original_amount": cost.get("amount"),
        "actual_amount": observed,
        "suggested_monthly": proposed,
        "forecast_amount": proposed if eligible else cost.get("amount"),
        "applied": eligible,
        "reason": "LOCKED_OR_CONTRACTUAL"
        if locked
        else "MONTHLY_MEDIAN"
        if eligible
        else "INSUFFICIENT_COMPLETE_MONTHS",
        "confidence_type": "Estimated" if proposed is not None else "Missing",
        "sample_months": len(months),
        "source_type": "inferred",
        "supporting_transaction_ids": [str(t.id) for t in rows],
        "source_refs": sorted({str(t.batch_id) for t in rows}),
        "synthetic": any(t.batch.source_type == "synthetic" for t in rows),
    }


def effective_draft(owner, draft, now):
    result, statistics = deepcopy(draft), analyze(owner, draft, now)
    changed = {c["cost_id"]: c for c in statistics["costs"] if c["applied"]}
    for cost in result["costs"]:
        if cost["cost_id"] in changed:
            row = changed[cost["cost_id"]]
            cost.update(
                amount=row["forecast_amount"],
                lower=None,
                upper=None,
                confidence_type="INFERRED",
                source_refs=row["source_refs"],
                paid=False,
            )
    return result, statistics


def detect(owner, now):
    rows = list(
        ObservedTransaction.objects.filter(
            owner=owner,
            date__lte=now,
            needs_review=False,
            category__in=["Rent", "Mobile", "Utilities", "Subscription", "Transport"],
        ).select_related("account")
    )
    converted = [
        Transaction(
            transaction_id=str(t.id),
            account_id=str(t.account_id),
            date=t.date,
            amount=t.amount,
            counterparty=t.counterparty,
            description=t.description,
            source_id=str(t.batch_id),
        )
        for t in rows
    ]
    return detect_recurring(converted, now)


def refresh(owner):
    semester, now = active(owner), business_date(owner)
    RecurringExpense.objects.filter(owner=owner).update(active=False)
    for pattern in detect(owner, now):
        account = owned(BankAccount, owner, pattern.account_id)
        item, _ = RecurringExpense.objects.get_or_create(
            owner=owner, account=account, merchant_key=normalized(pattern.counterparty)
        )
        item.result, item.active = pattern.model_dump(mode="json"), True
        item.save(update_fields=["result", "active"])
    result = analyze(owner, now=now)
    revision, _ = CalibrationRevision.objects.get_or_create(
        owner=owner,
        semester=semester,
        analysis_version=semester.analysis_version,
        budget_version=semester.version,
        as_of=now,
        defaults={"result": result},
    )
    return record(revision)


def review_recurring(owner, data, item):
    if data["cost_id"]:
        require(
            data["cost_id"] in {c["cost_id"] for c in active(owner).draft["costs"]},
            "UNKNOWN_COST",
        )
    item.decision, item.cost_id = data["decision"], data["cost_id"]
    item.save(update_fields=["decision", "cost_id"])
    if item.decision == "accepted" and item.cost_id:
        ObservedTransaction.objects.filter(
            owner=owner, id__in=item.result["supporting_transaction_ids"]
        ).update(cost_id=item.cost_id)
    from .imports import invalidate

    invalidate(owner)
    return record(item)


def provenance(cost):
    status = (
        "Missing"
        if cost.get("amount") is None
        else "Verified"
        if cost.get("confidence_type") == "VERIFIED"
        else "Estimated"
    )
    return {
        "status": status,
        "source_type": "controlled_confirmation"
        if status == "Verified"
        else "inferred"
        if cost.get("confidence_type") == "INFERRED"
        else "declared_or_template",
        "source_refs": cost.get("source_refs", []),
        "evidence": cost.get("evidence", []),
        "updated_at": cost.get("observed_at"),
        "valid_until": cost.get("valid_until"),
        "confidence": cost.get("confidence"),
        "synthetic": cost.get("synthetic", False),
    }
