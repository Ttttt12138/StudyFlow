"""Cash, debt, installments and audit share the caller's transaction."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select

from studyflow_backend.applications import ensure_future, event, locked_application
from studyflow_backend.errors import DomainError
from studyflow_backend.models import Installment, Ledger, Loan, Quote, identifier
from studyflow_backend.repository import assessment, owned
from studyflow_backend.transactions import audit, lock_wallet, require_version
from studyflow_backend.views import application_view, loan_view, wallet_view


def post_entry(session, wallet, entry):
    if wallet.balance + entry.amount < 0:
        raise DomainError("INSUFFICIENT_BALANCE")
    wallet.balance += entry.amount
    wallet.version += 1
    entry.balance_after = wallet.balance
    session.add(entry)


def create_loan(session, command, application):
    quote = session.get(Quote, application.quote_id)
    loan = Loan(
        application_id=application.id,
        student_id=application.student_id,
        outstanding_principal=Decimal(quote.data["principal"]),
        disbursed_at=command.now,
    )
    session.add(loan)
    session.flush()
    for row in quote.data["repayments"]:
        session.add(
            Installment(
                loan_id=loan.id,
                number=row["number"],
                due_date=date.fromisoformat(row["due_date"]),
                principal=Decimal(row["principal"]),
                interest=Decimal(row["interest"]),
                amount=Decimal(row["amount"]),
            )
        )
    return loan


def disburse(session, command, application_id, body):
    row, wallet = locked_application(session, application_id)
    require_version(row, body.expected_version)
    if row.state != "APPROVED":
        raise DomainError("INVALID_STATE")
    quote = session.get(Quote, row.quote_id)
    ensure_future(quote, command)
    result = assessment(session, quote, row.id)
    row.assessment, row.profile_version = result, result["profile_version"]
    row.version += 1
    if result["status"] != "AFFORDABLE":
        row.state = "UNDER_REVIEW"
        wallet.version += 1
        event(session, command, row, "DISBURSEMENT_REQUIRES_REVIEW", result)
        return {"application": application_view(row), "loan": None, "simulated": True}
    loan = create_loan(session, command, row)
    post_entry(
        session,
        wallet,
        Ledger(
            student_id=row.student_id,
            kind="DISBURSEMENT",
            reference=loan.id,
            amount=Decimal(quote.data["net_proceeds"]),
            reason="Simulated net loan proceeds",
            created_at=command.now,
        ),
    )
    row.state = "DISBURSED"
    event(session, command, row, "DISBURSED", {"loan_id": loan.id})
    return {
        "application": application_view(row),
        "loan": loan_view(session, loan, command.now.date()),
        "wallet": wallet_view(wallet),
        "simulated": True,
    }


def payable_installment(session, loan, body, today):
    installment = session.scalar(
        select(Installment)
        .where(
            Installment.loan_id == loan.id,
            Installment.paid_at.is_(None),
        )
        .order_by(Installment.number)
        .limit(1)
    )
    if installment is None or installment.number != body.installment_number:
        raise DomainError("INSTALLMENT_NOT_PAYABLE")
    if installment.due_date > today:
        raise DomainError("INSTALLMENT_NOT_DUE")
    return installment


def repay(session, command, loan_id, body):
    wallet = lock_wallet(session, command.actor_id)
    loan = owned(session, Loan, loan_id, command.actor_id)
    require_version(loan, body.expected_version)
    if loan.status != "ACTIVE":
        raise DomainError("LOAN_CLOSED")
    installment = payable_installment(session, loan, body, command.now.date())
    post_entry(
        session,
        wallet,
        Ledger(
            student_id=command.actor_id,
            kind="REPAYMENT",
            reference=installment.id,
            amount=-installment.amount,
            reason="Simulated scheduled repayment",
            created_at=command.now,
        ),
    )
    installment.paid_at = command.now
    loan.outstanding_principal -= installment.principal
    loan.version += 1
    if loan.outstanding_principal == 0:
        loan.status = "CLOSED"
    audit(
        session,
        command,
        {
            "student_id": command.actor_id,
            "object_id": loan.id,
            "event": "REPAID",
            "details": {"number": installment.number},
        },
    )
    return {
        "loan": loan_view(session, loan, command.now.date()),
        "wallet": wallet_view(wallet),
        "simulated": True,
    }


def topup(session, command, body):
    wallet = lock_wallet(session, body.student_id)
    require_version(wallet, body.expected_version)
    reference = identifier()
    post_entry(
        session,
        wallet,
        Ledger(
            student_id=body.student_id,
            kind="TOPUP",
            reference=reference,
            amount=body.amount,
            reason=body.reason,
            created_at=command.now,
        ),
    )
    audit(
        session,
        command,
        {
            "student_id": body.student_id,
            "object_id": reference,
            "event": "TOPUP",
            "details": {"reason": body.reason},
        },
    )
    return wallet_view(wallet)
