"""Export Django's authoritative B loan records through C's existing contracts."""

from datetime import datetime, time
from decimal import Decimal

from django.utils import timezone

from .affordability import assess
from .lending_applications import business_date
from .workflow_common import current, owned, require
from .workflow_models import (
    BudgetScenario,
    DemoLedgerEntry,
    SimulatedApplication,
)


def money(value):
    from studyflow_ai.readiness.models import MoneyValue

    return MoneyValue(currency="THB", amount=value)


def quote(application):
    from studyflow_ai.readiness.models import LoanQuote, Repayment

    data = application.loan.result
    decision = assess(application)
    return LoanQuote(
        quote_id=str(application.loan_id),
        principal=money(data["principal"]),
        net_proceeds=money(data["net_proceeds"]),
        fees=money(data["withheld_fee"]),
        total_interest=money(data["total_interest"]),
        repayments=[
            Repayment(due_date=row["due_date"], amount=money(row["payment"]))
            for row in data["schedule"]
        ],
        affordability=decision["status"],
        missing_inputs=decision["missing_inputs"],
        conditions=[
            "SIMULATED terms; not a lender offer",
            "Only B-recorded receipt changes cash",
        ],
    )


def export_application(owner, application_id):
    from studyflow_ai.readiness.models import ApplicationSnapshot, FundingSource

    application = owned(SimulatedApplication, owner, application_id)
    require(
        application.loan.result["currency"] == "THB",
        "Legacy foreign loans cannot use the B THB adapter.",
    )
    receipt = DemoLedgerEntry.objects.filter(
        disbursement__application=application
    ).first()
    received = receipt is not None
    usable = application.status not in {"CANCELLED", "REJECTED"} and not received
    return {
        "quote": quote(application),
        "application": ApplicationSnapshot(
            application_id=str(application.id),
            quote_id=str(application.loan_id),
            state="DISBURSED" if received else application.status,
        ),
        "source": FundingSource(
            funding_id="borrowing:" + str(application.id),
            kind="borrowing",
            allocatable=money(
                application.loan.result["net_proceeds"] if usable else "0.00"
            ),
            available_date=receipt.effective_on if received else None,
            received=received,
            loan_quote_id=str(application.loan_id),
            conditions=["SIMULATED", "B administrator must record disbursement"],
        ),
        "state_version": current(owner).version,
    }


def budget_from_scenario(scenario):
    from studyflow_ai.readiness.models import BudgetSnapshot, PaymentPoint

    result = scenario.result
    costs = [row for row in result["timeline"] if row["kind"] == "expense"]
    amount = sum((Decimal(row["amount"]) for row in costs), Decimal(0))
    return BudgetSnapshot(
        state_version=scenario.state.version,
        budget_version=scenario.revision,
        report_currency="THB",
        complete=False,
        low=money(amount),
        base=money(amount),
        high=money(amount),
        gap=money(result["maximum_reserve_gap"]),
        payment_points=[
            PaymentPoint(
                date=row["date"],
                required=money(row["amount"]),
                gap=money(row["reserve_gap"]),
            )
            for row in costs
        ],
        risks=["SINGLE_SCENARIO_NOT_FULL_READINESS_BUDGET"],
        assumptions=result["assumptions"]
        + ["Only the selected Django scenario is exported; range is not estimated."],
    )


def explain(actor, data, obj):
    from studyflow_ai.readiness.api import ReadinessAI
    from studyflow_ai.readiness.models import FundingContext

    from .budget_services import scenario_snapshot

    scenario = owned(BudgetScenario, actor, data["scenario_id"])
    current(actor, scenario.state.version)
    scenario_snapshot(actor, scenario.inputs)  # Revalidate referenced FX expiry.
    exported = export_application(actor, obj.id)
    context = FundingContext(
        student_id=str(actor.pk),
        now=timezone.make_aware(datetime.combine(business_date(actor), time(12))),
        budget=budget_from_scenario(scenario),
        sources=[exported["source"]],
        loan_quotes=[exported["quote"]],
        applications=[exported["application"]],
    )
    ai = ReadinessAI.mock()
    try:
        result = ai.generate_funding_candidates(context)
    finally:
        ai.close()
    require(
        result.loan_explanations[0].quote == exported["quote"],
        "C changed authoritative loan numbers.",
    )
    return {
        "mode": "mock",
        "scenario_id": str(scenario.id),
        "context": context.model_dump(mode="json"),
        "result": result.model_dump(mode="json"),
    }
