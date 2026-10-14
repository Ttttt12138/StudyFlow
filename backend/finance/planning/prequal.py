"""Loan pre-check: how much the family could borrow. Simulated and not binding.

As with a study loan sized by the cost of attendance minus other funds, the most that can be borrowed is the
full-course gap (in THB, the loan's currency) plus fees. Monthly income is not asked: the family chooses a term
whose monthly payment suits them, and the panel shows that payment plainly.
"""
from decimal import Decimal

from finance.readiness.budget import money

LONGEST_TERM = 60


def prequalify(inputs, gap):
    """`gap` is the full-course gap in THB, or None while funds are not declared."""
    from . import products

    terms = inputs["loan"]
    result = {"currency": "THB", "annual_rate": str(Decimal(terms["annual_rate"])), "longest_term": LONGEST_TERM,
              "products": products.offers(terms["annual_rate"]), "gap": gap, "max_principal": None}
    if gap is None:
        return {**result, "status": "unknown"}
    if Decimal(gap) <= 0:
        return {**result, "status": "no_gap", "max_principal": "0.00"}
    return {**result, "status": "enough", "max_principal": money(Decimal(gap) + Decimal(terms["fees"]))}


def preview(user, data):
    """Repayment figures for an amount and term being chosen, from the latest assessment's terms. Nothing is stored."""
    from datetime import date

    from finance.lending_core.calculations import calculate
    from finance.lending_core.schemas import QuoteInput
    from finance.workflow_common import require

    from . import services
    from .assessment import defaults, latest

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    item = latest(plan)
    inputs = item.inputs if item else defaults(user, plan)
    terms, check = inputs["loan"], (item.result.get("prequal") if item else None) or {}
    from . import products

    principal, months = Decimal(data["principal"]), int(data["months"])
    product = data.get("product") or "custom"
    method = data.get("method") or "amortized"
    products.check_term(product, months)
    products.check_method(product, method)
    grace = products.grace_months(plan, terms["first_due_date"], method)
    rate = products.rate(product, terms["annual_rate"])
    cap = check.get("max_principal")
    require(cap is None or principal <= Decimal(cap), "AMOUNT_ABOVE_PREQUAL")
    require(principal > Decimal(terms["fees"]), "LOAN_FEES_EXCEED_PRINCIPAL")
    result = calculate(QuoteInput(product=product, principal=principal,
                                  annual_rate=rate, fees=Decimal(terms["fees"]), months=months,
                                  first_due_date=date.fromisoformat(terms["first_due_date"]), grace_months=grace))
    payment = max(Decimal(r["amount"]) for r in result["repayments"])
    during = [Decimal(r["amount"]) for r in result["repayments"][:grace]]
    return {"principal": result["principal"], "months": months, "monthly_payment": money(payment),
            # Interest only while studying: how many months, and the most paid in one of them.
            "method": method, "interest_only_months": grace,
            "interest_only_payment": money(max(during)) if during else None,
            "annual_rate": format(rate.normalize(), "f"), "fees": result["fees"], "net_proceeds": result["net_proceeds"],
            "product": product,
            "total_interest": result["total_interest"], "total_repayment": result["total_repayment"],
            "first_due_date": result["repayments"][0]["due_date"], "last_due_date": result["repayments"][-1]["due_date"],
            # Every installment, so the family sees the whole plan before choosing.
            "schedule": [{k: r[k] for k in ("number", "due_date", "amount", "principal", "interest", "remaining_principal")}
                         for r in result["repayments"]],
            "currency": "THB", "is_simulated": True}
