"""Optional C boundary. Imports stay here; no C or LLM dependency in core lending."""

from datetime import date
from zoneinfo import ZoneInfo

from sqlalchemy import select

from studyflow_backend.models import Application, Loan, Quote, Wallet
from studyflow_backend.repository import assessment, owned


def thb(value):
    from studyflow_ai.readiness.models import MoneyValue

    return MoneyValue(currency="THB", amount=value)


def to_loan_quote(quote_id, data, decision):
    from studyflow_ai.readiness.models import LoanQuote, Repayment

    return LoanQuote(
        quote_id=quote_id,
        principal=thb(data["principal"]),
        net_proceeds=thb(data["net_proceeds"]),
        fees=thb(data["fees"]),
        total_interest=thb(data["total_interest"]),
        repayments=[
            Repayment(due_date=row["due_date"], amount=thb(row["amount"]))
            for row in data["repayments"]
        ],
        affordability=decision["status"],
        missing_inputs=decision["missing_inputs"],
        conditions=[
            "SIMULATED terms; not a lender offer",
            "Only recorded disbursement changes cash",
        ],
    )


def to_application(row):
    from studyflow_ai.readiness.models import ApplicationSnapshot

    return ApplicationSnapshot(application_id=row.id, quote_id=row.quote_id, state=row.state)


def to_funding_source(application, data, receipt_date):
    from studyflow_ai.readiness.models import FundingSource

    received = application.state == "DISBURSED"
    usable = application.state not in {"CANCELLED", "REJECTED"} and not received
    return FundingSource(
        funding_id=f"borrowing:{application.id}",
        kind="borrowing",
        allocatable=thb(data["net_proceeds"] if usable else "0.00"),
        available_date=receipt_date if received else None,
        received=received,
        loan_quote_id=application.quote_id,
        conditions=[
            "SIMULATED",
            f"Application state: {application.state}",
            "Receipt recorded by B"
            if received
            else "Funding date requires administrator disbursement",
        ],
    )


def export_application(session, application_id, student_id, now):
    application = owned(session, Application, application_id, student_id)
    quote = session.get(Quote, application.quote_id)
    loan = session.scalar(select(Loan).where(Loan.application_id == application_id))
    receipt_date = loan.disbursed_at.astimezone(ZoneInfo("Asia/Bangkok")).date() if loan else None
    return {
        "quote": to_loan_quote(quote.id, quote.data, assessment(session, quote, application.id)),
        "application": to_application(application),
        "source": to_funding_source(application, quote.data, receipt_date),
        "state_version": session.get(Wallet, student_id).version,
    }


def demo_context(export, student_id, now):
    from studyflow_ai.readiness.models import BudgetSnapshot, FundingContext, PaymentPoint

    budget = BudgetSnapshot(
        state_version=export["state_version"],
        budget_version=1,
        report_currency="THB",
        complete=False,
        low=thb("178200"),
        base=thb("190200"),
        high=thb("202200"),
        gap=thb("50000"),
        payment_points=[
            PaymentPoint(date=date(2026, 10, 15), required=thb("190200"), gap=thb("50000"))
        ],
        risks=["DEMO_BUDGET_FIXTURE_NOT_CALCULATED"],
        assumptions=["Synthetic budget fixture; B budget and FX engines are not implemented"],
    )
    return FundingContext(
        student_id=student_id,
        now=now,
        budget=budget,
        sources=[export["source"]],
        loan_quotes=[export["quote"]],
        applications=[export["application"]],
    )


def explain_demo(factory, application_id, student_id, now):
    from studyflow_ai.readiness.api import ReadinessAI

    with factory.begin() as session:
        session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        exported = export_application(session, application_id, student_id, now)
    context = demo_context(exported, student_id, now)
    ai = ReadinessAI.mock()
    try:
        result = ai.generate_funding_candidates(context)
    finally:
        ai.close()
    if result.loan_explanations[0].quote != exported["quote"]:
        raise RuntimeError("C changed authoritative loan numbers")
    return context, result
