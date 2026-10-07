from sqlalchemy import select

from studyflow_backend.calculations import amount_text
from studyflow_backend.models import Installment


def application_view(row):
    return {
        "application_id": row.id,
        "quote_id": row.quote_id,
        "state": row.state,
        "version": row.version,
        "profile_version": row.profile_version,
        "assessment": row.assessment,
        "simulated": True,
    }


def profile_view(row):
    return {
        "version": row.version if row else 0,
        "months": row.months if row else [],
        "simulated": True,
    }


def wallet_view(row):
    return {
        "student_id": row.student_id,
        "balance": amount_text(row.balance),
        "currency": "THB",
        "version": row.version,
        "simulated": True,
    }


def installment_view(row, today):
    status = "PAID" if row.paid_at else "OVERDUE" if row.due_date < today else "UNPAID"
    return {
        "number": row.number,
        "due_date": row.due_date.isoformat(),
        "principal": amount_text(row.principal),
        "interest": amount_text(row.interest),
        "amount": amount_text(row.amount),
        "status": status,
        "paid_at": row.paid_at.isoformat() if row.paid_at else None,
    }


def loan_view(session, loan, today):
    rows = session.scalars(
        select(Installment)
        .where(
            Installment.loan_id == loan.id,
        )
        .order_by(Installment.number)
    ).all()
    return {
        "loan_id": loan.id,
        "application_id": loan.application_id,
        "status": loan.status,
        "outstanding_principal": amount_text(loan.outstanding_principal),
        "version": loan.version,
        "currency": "THB",
        "simulated": True,
        "disbursed_at": loan.disbursed_at.isoformat(),
        "installments": [installment_view(row, today) for row in rows],
    }


def ledger_view(row):
    return {
        "entry_id": row.id,
        "sequence": row.sequence,
        "kind": row.kind,
        "reference": row.reference,
        "amount": amount_text(row.amount),
        "balance_after": amount_text(row.balance_after),
        "reason": row.reason,
        "created_at": row.created_at.isoformat(),
        "simulated": True,
    }
