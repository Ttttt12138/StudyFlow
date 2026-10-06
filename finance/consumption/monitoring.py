import hashlib
import json
from datetime import timedelta
from decimal import Decimal

from finance.lending_models import LoanInstallment
from finance.readiness.models import NotificationOutbox, RiskCard
from finance.readiness.services import active, business_date, converted_draft
from finance.workflow_common import current
from finance.workflow_models import FundingSource, Payment

from .analysis import provenance
from .projection import project_for


def overview(owner):
    semester, state, now = active(owner), current(owner), business_date(owner)
    prediction = project_for(
        owner, state.snapshot, converted_draft(owner, semester.draft), now
    )
    obligations = calendar_rows(owner, prediction)
    due = (
        LoanInstallment.objects.filter(owner=owner, paid_on__isnull=True)
        .order_by("due_on")
        .first()
    )
    risks = derived_risks(owner, prediction, due, now)
    active_risks = {k: v for k, v in risks.items() if v is not None}
    return {
        "status": "NEEDS_INFORMATION"
        if not prediction["complete"]
        else "AT_RISK"
        if active_risks
        else "SAFE",
        "as_of": now.isoformat(),
        "state_version": state.version,
        "budget_version": semester.version,
        "analysis_version": semester.analysis_version,
        "is_simulated": True,
        "data_issues": prediction.get("data_issues", []) + prediction["budget_issues"],
        "next_obligation": next(
            (e for e in obligations if e["status"] != "paid"), None
        ),
        "earliest_risk_date": prediction["first_gap_date"],
        "risks": active_risks,
        "actions": [{"kind": k, "reason": v} for k, v in active_risks.items()],
        "forecast_changes": prediction.get("calibration", {}),
        "calendar": obligations,
        "next_installment": {
            "id": str(due.id),
            "date": str(due.due_on),
            "amount": str(due.amount),
            "within_forecast": due.due_on <= now + timedelta(days=89),
        }
        if due
        else None,
        "cost_sources": {c["cost_id"]: provenance(c) for c in semester.draft["costs"]},
        "prediction": prediction,
    }


def calendar_rows(owner, prediction):
    paid = set(
        Payment.objects.filter(
            owner=owner,
            status__in=["settled", "reconciled", "reconciliation_exception"],
        ).values_list("event_id", flat=True)
    )
    state = current(owner)
    settled = {
        e["id"]: e
        for e in state.snapshot["events"]
        if "settled_sequence" in e and e["kind"] == "expense"
    }
    events = {e["id"]: e for e in prediction["timeline"] if e["kind"] == "expense"}
    for event in state.snapshot["events"]:
        if event["kind"] == "expense" and (
            not event.get("date") or event["date"] > prediction["end_date"]
        ):
            events.setdefault(event["id"], event)
    events.update(settled)
    rows = []
    for key, event in events.items():
        rows.append(
            {
                **event,
                "status": "paid" if key in paid or key in settled else "due",
                "source_type": "loan_contract"
                if key.startswith("repayment:")
                else "inferred"
                if key.startswith("recurring:")
                else "budget_or_invoice",
                "within_forecast": bool(
                    event.get("date") and event["date"] <= prediction["end_date"]
                ),
            }
        )
    return sorted(rows, key=lambda row: (row["date"] or "9999", row["id"]))


def derived_risks(owner, prediction, due, now):
    gap = Decimal(prediction["maximum_reserve_gap"]) > 0
    overdue = [
        e["id"]
        for e in current(owner).snapshot["events"]
        if e["kind"] == "expense"
        and e.get("date")
        and e["date"] < now.isoformat()
        and "settled_sequence" not in e
        and e.get("certainty") == "confirmed"
    ]
    late = list(
        FundingSource.objects.filter(
            owner=owner,
            kind__in=["family", "family_support"],
            received=False,
            available_on__lt=now,
        ).values_list("id", flat=True)
    )
    changed = [
        c["cost_id"]
        for c in prediction.get("calibration", {}).get("costs", [])
        if c["applied"]
        and c["original_amount"] is not None
        and Decimal(c["forecast_amount"]) > Decimal(c["original_amount"])
    ]
    return {
        "repayment_liquidity": {
            "installment_id": str(due.id),
            "gap": prediction["maximum_reserve_gap"],
        }
        if due and due.due_on <= now + timedelta(days=89) and gap
        else None,
        "cashflow_gap": {
            "date": prediction["first_gap_date"],
            "amount": prediction["maximum_reserve_gap"],
        }
        if gap
        else None,
        "sponsor_delayed": {"source_ids": list(map(str, late))} if late else None,
        "spending_increased": {"cost_ids": changed} if changed else None,
        "overdue_obligations": {"event_ids": overdue} if overdue else None,
        "data_stale": {"issues": prediction.get("data_issues", [])}
        if not prediction["complete"]
        else None,
    }


def update_monitoring(owner):
    semester = active(owner)
    result = overview(owner)
    kinds = {
        "repayment_liquidity",
        "cashflow_gap",
        "sponsor_delayed",
        "spending_increased",
        "overdue_obligations",
        "data_stale",
    }
    for kind in sorted(kinds):
        details = result["risks"].get(kind)
        card = RiskCard.objects.filter(semester=semester, kind=kind).first()
        if details is None and (
            card is None
            or (
                card.active
                and result["status"] == "NEEDS_INFORMATION"
                and kind != "data_stale"
            )
        ):
            continue
        fingerprint = hashlib.sha256(
            json.dumps(details, sort_keys=True).encode()
        ).hexdigest()
        if card and card.fingerprint == fingerprint:
            continue
        transition = (
            "created" if card is None else "resolved" if details is None else "changed"
        )
        card = card or RiskCard(owner=owner, semester=semester, kind=kind)
        card.details, card.active, card.fingerprint = (
            details or {},
            details is not None,
            fingerprint,
        )
        card.save()
        NotificationOutbox.objects.create(
            owner=owner,
            risk=card,
            transition=transition,
            payload={"kind": kind, "details": details},
        )
    return result
