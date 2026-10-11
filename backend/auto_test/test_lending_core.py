from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from finance.lending_core.calculations import assess, calculate
from finance.lending_core.schemas import MonthBudget, QuoteInput


def terms(**changes):
    return QuoteInput.model_validate(
        dict(
            principal="30600.00",
            annual_rate="0",
            fees="600.00",
            months=12,
            first_due_date="2026-11-01",
            **changes,
        )
    )


def test_zero_interest_fixture():
    quote = calculate(terms())
    assert quote["net_proceeds"] == "30000.00"
    assert quote["total_interest"] == "0.00"
    assert len(quote["repayments"]) == 12
    assert {r["amount"] for r in quote["repayments"]} == {"2550.00"}


@pytest.mark.parametrize(
    "rate,principal,months",
    [
        ("0.12", "10000.00", 12),
        ("0", "100.00", 3),
        ("0.375", "98765.43", 60),
    ],
)
def test_schedule_conserves_money(rate, principal, months):
    data = terms().model_copy(
        update={
            "annual_rate": Decimal(rate),
            "principal": Decimal(principal),
            "months": months,
            "fees": Decimal("0"),
        }
    )
    result = calculate(data)
    rows = result["repayments"]
    assert sum(Decimal(r["principal"]) for r in rows) == Decimal(principal)
    assert sum(Decimal(r["interest"]) for r in rows) == Decimal(
        result["total_interest"]
    )
    assert sum(Decimal(r["amount"]) for r in rows) == Decimal(result["total_repayment"])
    assert rows[-1]["remaining_principal"] == "0.00"
    for row in rows:
        assert Decimal(row["amount"]) == Decimal(row["principal"]) + Decimal(
            row["interest"]
        )


def test_month_end_anchor_recovers_after_february():
    quote = calculate(terms().model_copy(update={"first_due_date": date(2028, 1, 31)}))
    assert [r["due_date"] for r in quote["repayments"][:3]] == [
        "2028-01-31",
        "2028-02-29",
        "2028-03-31",
    ]


@pytest.mark.parametrize(
    "field,value",
    [
        ("fees", "30600"),
        ("principal", "0"),
        ("principal", "NaN"),
        ("fees", "-1"),
        ("months", 61),
        ("annual_rate", "-0.1"),
        ("principal", "1.001"),
        ("currency", "CNY"),
        ("principal", 100.5),
    ],
)
def test_invalid_terms(field, value):
    data = terms().model_dump()
    data[field] = value
    with pytest.raises(ValidationError):
        QuoteInput.model_validate(data)


def test_reject_unrepresentable_small_installments():
    data = terms().model_dump()
    data.update(principal="0.01", fees="0", months=60)
    with pytest.raises(ValueError, match="INSTALLMENT_TOO_SMALL"):
        calculate(QuoteInput.model_validate(data))


def budgets(quote, income="10000"):
    return [
        MonthBudget(
            month=r["due_date"][:7],
            income=income,
            living_expenses="4000",
            existing_repayments="1000",
        )
        for r in quote["repayments"]
    ]


def test_affordability_complete_missing_and_insufficient():
    quote = calculate(terms())
    assert assess(quote, [])["status"] == "INSUFFICIENT_DATA"
    assert assess(quote, budgets(quote))["status"] == "AFFORDABLE"
    data = budgets(quote)
    data[-1] = data[-1].model_copy(update={"income": Decimal("5000")})
    assert assess(quote, data)["status"] == "UNAFFORDABLE"
    assert assess(quote, data[:-1])["status"] == "INSUFFICIENT_DATA"


def test_explicit_zero_is_valid_missing_is_not_zero():
    row = MonthBudget(month="2026-11", income="0", living_expenses="0")
    assert row.existing_repayments is None
    quote = calculate(terms())
    result = assess(quote, [row])
    assert "2026-11.existing_repayments" in result["missing_inputs"]
