from datetime import date
from decimal import Decimal
from finance import budget_services
from finance.workflow_common import require

from . import products


def create_quotes(user, inputs, check):
    """One quote for the amount, term and product the family picked, within the pre-check's maximum.

    No amount picked means the pre-check's maximum. A planning loan is approved by the pre-check (planning_decision),
    not by a month-by-month budget, so the quote carries no affordability verdict."""
    terms = inputs["loan"]
    cap = check["max_principal"]
    principal = terms["principal"]
    if principal is None:
        if cap is None:
            return []
        principal = cap
    elif cap is not None:
        require(Decimal(principal) <= Decimal(cap), "AMOUNT_ABOVE_PREQUAL")
    if Decimal(principal) <= 0:
        return []
    require(Decimal(principal) > Decimal(terms["fees"]), "LOAN_FEES_EXCEED_PRINCIPAL")
    months = int(terms.get("months") or (terms.get("periods") or [48])[0])
    product = terms.get("product") or "custom"
    products.check_term(product, months)
    body = {"product": product, "currency": "THB", "principal": str(principal),
            "annual_rate": str(products.rate(product, terms["annual_rate"])), "fees": terms["fees"], "months": months,
            "first_due_date": date.fromisoformat(terms["first_due_date"])}
    quote = budget_services.create_loan(user, body)
    quote["assessment"] = {"status": "NOT_ASSESSED", "missing_inputs": [], "shortfall_months": []}
    return [quote]
