from datetime import timedelta

import pytest

pytest.importorskip("studyflow_ai")

from studyflow_backend.c_adapter import explain_demo

pytestmark = pytest.mark.postgres


def test_c_reads_real_quote_without_changing_numbers(api):
    quote = api.quote(annual_rate="0.12")
    application = api.application(quote, with_profile=False)
    context, result = explain_demo(api.factory, application["application_id"], "student", api.clock)
    actual = result.loan_explanations[0].quote
    assert actual == context.loan_quotes[0]
    assert actual.total_interest.amount == quote_decimal(quote["total_interest"])
    assert [str(row.amount.amount) for row in actual.repayments] == [
        row["amount"] for row in quote["repayments"]
    ]
    assert actual.affordability == "INSUFFICIENT_DATA"
    assert "无法判断还款能力" in result.loan_explanations[0].message
    assert result.candidates[0].validation == "PENDING"
    assert context.budget.complete is False
    assert context.sources[0].funding_id != actual.quote_id


def quote_decimal(value):
    from decimal import Decimal

    return Decimal(value)


def test_c_rejects_reallocation_after_disbursement(api):
    result = api.disburse()
    application = result["application"]
    context, explanation = explain_demo(
        api.factory, application["application_id"], "student", api.clock
    )
    assert context.sources[0].received is True
    assert context.sources[0].allocatable.amount == 0
    assert explanation.applications[0].state == "DISBURSED"
    assert explanation.candidates[0].validation == "INVALID"
    assert "FUNDS_ALREADY_IN_BALANCE" in [issue.code for issue in explanation.candidates[0].issues]


def test_export_preserves_actual_receipt_date_on_later_reads(api):
    receipt_date = api.clock.date()
    application = api.disburse()["application"]
    api.clock += timedelta(days=15)
    context, _ = explain_demo(api.factory, application["application_id"], "student", api.clock)
    assert context.sources[0].available_date == receipt_date
