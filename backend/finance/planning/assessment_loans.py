"""The loan the family types into the plan: its limit, its quote and instant repayment figures. Simulated, not binding.

The most a family may borrow is the plan's full-course total in THB (the loan's currency), as a
study loan is sized by the cost of attendance. Monthly income is not asked: the family chooses a term whose monthly
payment suits them, and the panel shows that payment plainly.
"""
from datetime import date
from decimal import Decimal

from finance import budget_services
from finance.readiness.budget import money
from finance.workflow_common import require

from . import products, services


def limit(plan, fees="0.00"):
    """{"max_principal", "currency"}: the full-course total (its known part while lines are missing) converted to THB,
    max_principal is None without an exchange rate or once the school left the catalog."""
    total = services.course_total(plan)
    value = services.convert(total["total"], total["currency"], "THB") if total else None
    return {"max_principal": money(Decimal(value["amount"])) if value else None, "currency": "THB"}


def check_principal(principal, terms, cap):
    require(cap is None or Decimal(principal) <= Decimal(cap), "AMOUNT_ABOVE_LIMIT")
    require(Decimal(principal) > Decimal(terms["fees"]), "LOAN_FEES_EXCEED_PRINCIPAL")


def create_quotes(user, inputs, cap, plan=None):
    """One quote for the amount, term and product the family picked; none until they type an amount.

    A planning loan is approved against the limit (assessment.planning_decision), not by a month-by-month budget,
    so the quote carries no affordability verdict."""
    terms = inputs["loan"]
    principal = terms.get("principal")
    if principal in (None, "") or Decimal(principal) <= 0:
        return []
    check_principal(principal, terms, cap)
    months = int(terms.get("months") or (terms.get("periods") or [48])[0])
    product = terms.get("product") or "custom"
    method = terms.get("method") or "amortized"
    products.check_term(product, months)
    products.check_method(product, method)
    body = {"product": product, "currency": "THB", "principal": str(principal),
            "annual_rate": str(products.rate(product, terms["annual_rate"])), "fees": terms["fees"], "months": months,
            "first_due_date": date.fromisoformat(str(terms["first_due_date"])),
            "grace_months": products.grace_months(plan, terms["first_due_date"], method) if plan is not None else 0}
    quote = budget_services.create_loan(user, body)
    quote["assessment"] = {"status": "NOT_ASSESSED", "missing_inputs": [], "shortfall_months": []}
    return [quote]


def preview(user, data):
    """Repayment figures for an amount and term being chosen, from the latest assessment's terms. Nothing is stored."""
    from finance.lending_core.calculations import calculate
    from finance.lending_core.schemas import QuoteInput

    from .assessment import defaults, latest

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    item = latest(plan)
    terms = (item.inputs if item else defaults(user, plan))["loan"]
    principal, months = Decimal(data["principal"]), int(data["months"])
    product = data.get("product") or "custom"
    method = data.get("method") or "amortized"
    products.check_term(product, months)
    products.check_method(product, method)
    grace = products.grace_months(plan, terms["first_due_date"], method)
    rate = products.rate(product, terms["annual_rate"])
    check_principal(principal, terms, limit(plan, terms["fees"])["max_principal"])
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
