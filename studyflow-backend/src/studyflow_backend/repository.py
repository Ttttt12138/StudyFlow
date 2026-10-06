from decimal import Decimal

from sqlalchemy import select

from studyflow_backend.calculations import assess
from studyflow_backend.errors import DomainError
from studyflow_backend.models import Application, Installment, Loan, Profile, Quote
from studyflow_backend.schemas import MonthBudget


def owned(session, model, object_id, student_id=None):
    query = select(model).where(model.id == object_id)
    if student_id is not None:
        query = query.where(model.student_id == student_id)
    row = session.scalar(query.execution_options(populate_existing=True))
    if row is None:
        raise DomainError("NOT_FOUND", 404)
    return row


def other_commitments(session, student_id, exclude_id):
    applications = session.scalars(
        select(Application).where(
            Application.student_id == student_id,
            Application.id != exclude_id,
            Application.state.in_(["APPROVED", "DISBURSED"]),
        )
    ).all()
    totals = {}
    for application in applications:
        quote = session.get(Quote, application.quote_id)
        paid = paid_numbers(session, application.id)
        for row in quote.data["repayments"]:
            if row["number"] not in paid:
                month = row["due_date"][:7]
                totals[month] = totals.get(month, Decimal("0")) + Decimal(row["amount"])
    return totals


def paid_numbers(session, application_id):
    return set(
        session.scalars(
            select(Installment.number)
            .join(Loan)
            .where(
                Loan.application_id == application_id,
                Installment.paid_at.is_not(None),
            )
        )
    )


def assessment(session, quote, exclude_id=""):
    profile = session.get(Profile, quote.student_id)
    budgets = [MonthBudget.model_validate(row) for row in profile.months] if profile else []
    result = assess(quote.data, budgets, other_commitments(session, quote.student_id, exclude_id))
    result["profile_version"] = profile.version if profile else 0
    return result
