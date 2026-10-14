"""B's arithmetic projected for existing Django budget consumers."""

from decimal import Decimal

from .lending_core.calculations import calculate
from .lending_core.schemas import QuoteInput


def budget_rows(result):
    opening, rows = Decimal(result["principal"]), []
    for row in result["repayments"]:
        rows.append(
            {
                **row,
                "payment": row["amount"],
                "phase": "interest_only" if Decimal(row["principal"]) == 0 else "repayment",
                "opening_balance": format(opening, ".2f"),
                "closing_balance": row["remaining_principal"],
            }
        )
        opening = Decimal(row["remaining_principal"])
    return rows


def loan_schedule(data):
    result = calculate(QuoteInput.model_validate(data))
    total_cost = Decimal(result["total_repayment"]) - Decimal(result["net_proceeds"])
    maximum = max(Decimal(row["amount"]) for row in result["repayments"])
    return {
        **result,
        "is_simulated": True,
        "schedule": budget_rows(result),
        "withheld_fee": result["fees"],
        "total_cost_over_net_proceeds": format(total_cost, ".2f"),
        "maximum_installment": format(maximum, ".2f"),
        "affordability_status": "insufficient_information",
    }
