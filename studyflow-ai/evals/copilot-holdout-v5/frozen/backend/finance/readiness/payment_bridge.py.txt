from datetime import date
from decimal import Decimal

from finance.readiness.models import InvoiceIdentity, ReadinessRun
from finance.readiness.services import active
from finance.services import VersionConflict
from finance.workflow_common import current, owned, require
from finance.workflow_models import Beneficiary
from finance.money import home_currency


def evaluate_payment(owner, run):
    from finance.readiness.funding import evaluate

    semester, state = active(owner), current(owner)
    require(
        run.kind == "funding" and run.semester_id == semester.id,
        "READINESS_FUNDING_PLAN_REQUIRED",
    )
    if (run.state_version, run.budget_version, run.analysis_version) != (
        state.version,
        semester.version,
        semester.analysis_version,
    ):
        raise VersionConflict()
    result = evaluate(owner, semester, state, run.inputs)
    require(result["validation"] == "VALID", "READINESS_PLAN_NOT_EXECUTABLE")
    return state, semester, result


def create(owner, data):
    from finance.workflow_models import Payment

    run = owned(ReadinessRun, owner, data["readiness_plan_id"])
    state, semester, _result = evaluate_payment(owner, run)
    event = next(
        (e for e in state.snapshot["events"] if e["id"] == data["event_id"]), None
    )
    require(
        event
        and event["kind"] == "expense"
        and event["certainty"] == "confirmed"
        and "settled_sequence" not in event,
        "CONFIRMED_UNPAID_TUITION_REQUIRED",
    )
    beneficiary = owned(Beneficiary, owner, data["beneficiary_id"])
    evidence = invoice_evidence(owner, semester, event, beneficiary)
    check_cash(owner, event, state.snapshot["reserve"])
    require(
        not Payment.objects.filter(owner=owner, event_id=event["id"])
        .exclude(status__in=["failed", "cancelled", "expired"])
        .exists(),
        "PAYMENT_ALREADY_EXISTS",
    )
    return Payment.objects.create(
        owner=owner,
        readiness_plan=run,
        state=state,
        beneficiary=beneficiary,
        event_id=event["id"],
        amount=event["amount"],
        due_on=event["date"],
        invoice_snapshot=evidence,
        execution_context={
            "state_version": state.version,
            "budget_version": semester.version,
            "analysis_version": semester.analysis_version,
        },
    )


def invoice_evidence(owner, semester, event, beneficiary):
    from finance.readiness.imports import invoice_fingerprint

    cost = next(
        (
            c
            for c in semester.draft["costs"]
            if event["id"].startswith("cost:" + c["cost_id"] + ":")
        ),
        None,
    )
    require(
        cost
        and cost["category"] == "tuition"
        and cost.get("invoice_id")
        and cost.get("issuer")
        and cost.get("confidence_type") == "VERIFIED",
        "VERIFIED_TUITION_INVOICE_REQUIRED",
    )
    require(
        beneficiary.verified and event.get("beneficiary_id") == str(beneficiary.id),
        "VERIFIED_INVOICE_BENEFICIARY_REQUIRED",
    )
    identity = InvoiceIdentity.objects.filter(
        owner=owner,
        issuer=cost["issuer"].casefold().strip(),
        invoice_id=cost["invoice_id"],
    ).first()
    require(
        identity is not None and cost["currency"] == home_currency(), "INVOICE_IDENTITY_REQUIRED"
    )
    require(
        identity.fingerprint == invoice_fingerprint(cost), "INVOICE_IDENTITY_CHANGED"
    )
    evidence = {
        k: cost[k]
        for k in (
            "invoice_id",
            "issuer",
            "currency",
            "amount",
            "beneficiary_id",
            "due_date",
        )
    }
    return {**evidence, "event_id": event["id"], "identity_id": str(identity.id)}


def check_cash(owner, event, reserve):
    from finance.execution_services import available, wallet

    item = wallet(owner)
    require(
        event.get("date") and item.clock <= date.fromisoformat(event["date"]),
        "PAYMENT_DEADLINE_PASSED",
    )
    require(
        Decimal(event["amount"]) > 0
        and available(item) - Decimal(event["amount"]) >= Decimal(reserve),
        "SETTLED_FUNDS_REQUIRED",
    )


def check(payment):
    from finance.execution_services import available, wallet

    state, _semester, result = evaluate_payment(payment.owner, payment.readiness_plan)
    require(payment.state_id == state.id, "PAYMENT_STATE_CHANGED")
    require(payment.beneficiary.verified, "BENEFICIARY_VERIFICATION_REVOKED")
    require(
        available(wallet(payment.owner)) - payment.amount
        >= Decimal(state.snapshot["reserve"]),
        "SETTLED_FUNDS_REQUIRED",
    )
    return result


def reconcile_invoice(payment):
    from finance.readiness.models import InvoiceIdentity

    receipt, evidence = payment.receipt, payment.invoice_snapshot
    fields = (
        "invoice_id",
        "issuer",
        "currency",
        "amount",
        "beneficiary_id",
        "event_id",
    )
    if not receipt or any(str(receipt.get(k)) != str(evidence.get(k)) for k in fields):
        return False
    return InvoiceIdentity.objects.filter(
        pk=evidence.get("identity_id"),
        owner=payment.owner,
        invoice_id=evidence["invoice_id"],
        issuer=evidence["issuer"].casefold().strip(),
    ).exists()
