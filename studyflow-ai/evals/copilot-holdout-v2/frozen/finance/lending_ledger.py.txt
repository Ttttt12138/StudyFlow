from copy import deepcopy
from datetime import date
from decimal import Decimal

from .lending_models import LoanAccount, LoanInstallment
from .services import VersionConflict
from .workflow_common import append_state, audit, current, record, require
from .workflow_models import DemoLedgerEntry, FundingSource, Payment


def wallet_for(owner):
    from .execution_services import wallet

    return wallet(owner)


def account_record(account):
    today = wallet_for(account.owner).clock
    installments = []
    for row in account.installments.all():
        status = (
            "PAID"
            if row.paid_on
            else "OVERDUE"
            if row.due_on < today
            else "DUE"
            if row.due_on == today
            else "SCHEDULED"
        )
        installments.append({**record(row), "status": status})
    return {**record(account), "installments": installments, "is_simulated": True}


def create_account(disbursement):
    rows = [
        row
        for row in disbursement.application.loan.result["schedule"]
        if Decimal(row["payment"]) > 0
    ]
    account = LoanAccount.objects.create(
        owner=disbursement.owner,
        disbursement=disbursement,
        outstanding_principal=sum(Decimal(row["principal"]) for row in rows),
    )
    LoanInstallment.objects.bulk_create(
        [
            LoanInstallment(
                owner=account.owner,
                account=account,
                number=row["number"],
                due_on=date.fromisoformat(row["due_date"]),
                amount=row["payment"],
                principal=row["principal"],
            )
            for row in rows
        ]
    )
    return account


def post_entry(item, amount, origin):
    balance = item.balance + amount
    require(
        Decimal(0) <= balance <= Decimal("9999999999999999.99"),
        "INSUFFICIENT_BALANCE_OR_PRECISION",
    )
    sequence = DemoLedgerEntry.objects.filter(owner=item.owner).count() + 1
    entry = DemoLedgerEntry.objects.create(
        owner=item.owner,
        amount=amount,
        sequence=sequence,
        effective_on=item.clock,
        **origin,
    )
    item.balance = balance
    item.save(update_fields=["balance"])
    return entry


def loan_events(disbursement, entry):
    loan = disbursement.application.loan
    events = [
        {
            "id": "loan:" + str(loan.id),
            "label": "Simulated loan disbursement",
            "kind": "income",
            "amount": format(disbursement.amount, ".2f"),
            "date": entry.effective_on.isoformat(),
            "certainty": "confirmed",
            "settled_sequence": entry.sequence,
        }
    ]
    events.extend(
        {
            "id": f"repayment:{loan.id}:{row['number']}",
            "label": "Simulated loan repayment",
            "kind": "expense",
            "amount": row["payment"],
            "date": row["due_date"],
            "certainty": "confirmed",
        }
        for row in loan.result["schedule"]
        if Decimal(row["payment"]) > 0
    )
    return events


def settle_loan(disbursement, actor):
    item = wallet_for(disbursement.owner)
    snapshot = deepcopy(current(item.owner).snapshot)
    require(
        not any(
            e["id"] == "loan:" + str(disbursement.application.loan_id)
            for e in snapshot["events"]
        ),
        "Loan already represented in state.",
    )
    entry = post_entry(
        item, Decimal(disbursement.amount), {"disbursement": disbursement}
    )
    account = create_account(disbursement)
    snapshot["events"].extend(loan_events(disbursement, entry))
    append_state(item.owner, snapshot, actor, "state.disbursement_received")
    FundingSource.objects.filter(loan=disbursement.application.loan).update(
        received=True
    )
    return account_record(account), record(item)


def payable(account, data, today):
    if account.version != data["expected_version"]:
        raise VersionConflict()
    require(account.status == "ACTIVE", "LOAN_CLOSED")
    row = account.installments.filter(paid_on__isnull=True).order_by("number").first()
    require(
        row is not None and row.number == data["installment_number"],
        "INSTALLMENT_NOT_PAYABLE",
    )
    require(row.due_on <= today, "INSTALLMENT_NOT_DUE")
    return row


def settle_repayment_state(actor, row, entry):
    loan_id = row.account.disbursement.application.loan_id
    snapshot = deepcopy(current(actor).snapshot)
    event_id = f"repayment:{loan_id}:{row.number}"
    event = next((item for item in snapshot["events"] if item["id"] == event_id), None)
    require(
        event is not None and "settled_sequence" not in event,
        "Repayment state is unavailable or already settled.",
    )
    require(
        not Payment.objects.filter(owner=actor, event_id=event_id)
        .exclude(status__in=["cancelled", "failed", "expired"])
        .exists(),
        "Repayment has an existing payment task.",
    )
    event.update(date=entry.effective_on.isoformat(), settled_sequence=entry.sequence)
    append_state(actor, snapshot, actor, "state.loan_repaid")


def repay(actor, data, obj):
    from .execution_services import available

    item = wallet_for(actor)
    row = payable(obj, data, item.clock)
    require(available(item) >= row.amount, "INSUFFICIENT_BALANCE")
    entry = post_entry(item, -row.amount, {"installment": row})
    settle_repayment_state(actor, row, entry)
    row.paid_on = item.clock
    row.save(update_fields=["paid_on"])
    obj.outstanding_principal -= row.principal
    obj.version += 1
    if not obj.installments.filter(paid_on__isnull=True).exists():
        obj.status = "CLOSED"
    obj.save()
    audit(actor, actor, "loan.REPAID", obj, {"number": row.number})
    return {"account": account_record(obj), "wallet": record(item), "simulated": True}
