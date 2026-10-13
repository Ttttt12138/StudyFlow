from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from finance import affordability, budget_services
from finance.lending_core.calculations import assess, month_date
from finance.lending_core.schemas import MonthBudget
from finance.workflow_common import require


def repayment_months(inputs, last_due):
    recurring = inputs["repayment"]
    first = inputs["loan"]["first_due_date"][:7]
    changes = {c["month"]: c for c in recurring["changes"]}
    values = {key: recurring[key] for key in ("income", "living_expenses", "existing_repayments")}
    # Changes persist from their effective month, including changes before the first repayment.
    rows, changes = [], sorted(changes.items())
    for offset in range(60):
        month = month_date(date.fromisoformat(first + "-01"), offset).strftime("%Y-%m")
        if month > last_due[:7]:
            break
        while changes and changes[0][0] <= month:
            values.update({k: v for k, v in changes.pop(0)[1].items() if k != "month"})
        covered = bool(recurring["from_month"]) and recurring["from_month"] <= month <= recurring["to_month"]
        rows.append({"month": month, **{k: v if covered else None for k, v in values.items()}})
    return rows


def create_quotes(user, inputs, projection):
    terms = inputs["loan"]
    principal = terms["principal"]
    if principal is None and projection["suggested_principal"] is not None:
        if Decimal(projection["suggested_principal"]) <= 0:
            return []
        principal = str(Decimal(projection["suggested_principal"]) + Decimal(terms["fees"]))
    if principal is None or Decimal(principal) <= 0:
        return []
    require(Decimal(principal) > Decimal(terms["fees"]), "LOAN_FEES_EXCEED_PRINCIPAL")
    additional = affordability.commitments(SimpleNamespace(owner=user, pk=None))
    quotes = []
    options = [(months, "custom") for months in dict.fromkeys(terms["periods"])]
    options.append((48, "commercial_student_demo"))
    for months, product in options:
        body = {"product": product, "currency": "THB", "principal": principal, "annual_rate": terms["annual_rate"],
                "fees": terms["fees"], "months": months, "first_due_date": date.fromisoformat(terms["first_due_date"])}
        quote = budget_services.create_loan(user, body)
        rows = repayment_months(inputs, quote["result"]["repayments"][-1]["due_date"])
        quote["assessment"] = assess(quote["result"], [MonthBudget.model_validate(r) for r in rows], additional)
        quote["repayment_months"] = rows
        quotes.append(quote)
    return quotes
