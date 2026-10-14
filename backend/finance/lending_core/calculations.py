"""Pure, deterministic loan arithmetic; no database or model calls."""

import calendar
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext

from .schemas import MonthBudget, QuoteInput

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def amount_text(value):
    return format(money(value), ".2f")


def month_date(anchor: date, offset: int) -> date:
    month_index = anchor.year * 12 + anchor.month - 1 + offset
    year, month = divmod(month_index, 12)
    month += 1
    return date(year, month, min(anchor.day, calendar.monthrange(year, month)[1]))


def scheduled_payment(terms, rate):
    if rate == 0:
        return money(terms.principal / terms.months)
    growth = (1 + rate) ** terms.months
    return money(terms.principal * rate * growth / (growth - 1))


def repayment_rows(terms):
    """`grace_months` rows of interest only, then `months` equal installments that repay the principal."""
    balance, rows = terms.principal, []
    rate = terms.annual_rate / 12
    payment = scheduled_payment(terms, rate)
    grace, last = terms.grace_months, terms.grace_months + terms.months - 1
    for offset in range(last + 1):
        interest = money(balance * rate)
        if offset < grace:
            principal = ZERO
        else:
            principal = balance if offset == last else payment - interest
            if principal <= 0 or principal > balance:
                raise ValueError("INSTALLMENT_TOO_SMALL")
        balance = money(balance - principal)
        rows.append(
            {
                "number": offset + 1,
                "due_date": month_date(terms.first_due_date, offset).isoformat(),
                "principal": amount_text(principal),
                "interest": amount_text(interest),
                "amount": amount_text(principal + interest),
                "remaining_principal": amount_text(balance),
            }
        )
    return rows


def calculate(terms: QuoteInput) -> dict:
    with localcontext() as ctx:
        ctx.prec = 50
        rows = repayment_rows(terms)
        interest = sum((Decimal(r["interest"]) for r in rows), ZERO)
        return {
            "currency": "THB",
            "principal": amount_text(terms.principal),
            "net_proceeds": amount_text(terms.principal - terms.fees),
            "fees": amount_text(terms.fees),
            "total_interest": amount_text(interest),
            "total_repayment": amount_text(terms.principal + interest),
            "repayments": rows,
            "terms": terms.model_dump(mode="json"),
            "simulated": True,
        }


def month_capacity(row: MonthBudget | None, month: str):
    fields = ("income", "living_expenses", "existing_repayments")
    missing = [f"{month}.{f}" for f in fields if row is None or getattr(row, f) is None]
    if missing:
        return None, missing
    return row.income - row.living_expenses - row.existing_repayments, []


def assess(quote: dict, budgets: list[MonthBudget], additional=None) -> dict:
    by_month = {row.month: row for row in budgets}
    missing, shortfalls = [], []
    for installment in quote["repayments"]:
        month = installment["due_date"][:7]
        capacity, gaps = month_capacity(by_month.get(month), month)
        missing.extend(gaps)
        required = Decimal(installment["amount"]) + (additional or {}).get(month, ZERO)
        if capacity is not None and capacity < required:
            shortfalls.append(month)
    status = (
        "INSUFFICIENT_DATA"
        if missing
        else "UNAFFORDABLE"
        if shortfalls
        else "AFFORDABLE"
    )
    return {"status": status, "missing_inputs": missing, "shortfall_months": shortfalls}
