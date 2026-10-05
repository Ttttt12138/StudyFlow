from datetime import date

from studyflow_ai.models import Transaction
from studyflow_ai.recurring import detect_recurring


def tx(day, amount="-9000", account="a", payee="Condo"):
    return Transaction(
        transaction_id=day,
        account_id=account,
        date=day,
        amount=amount,
        counterparty=payee,
        description="Monthly rent",
        source_id="history",
    )


def test_three_months_and_future_ignored():
    result = detect_recurring(
        [tx("2026-07-05"), tx("2026-08-05"), tx("2026-09-05"), tx("2026-10-05", "-50000")],
        date(2026, 10, 2),
    )
    assert len(result) == 1
    assert result[0].expected_next_date == date(2026, 10, 5)
    assert result[0].amount == 9000
    assert result[0].status == "READY"


def test_two_months_review_and_missing_month_no_pattern():
    assert (
        detect_recurring([tx("2026-08-05"), tx("2026-09-05")], date(2026, 10, 2))[0].status
        == "NEEDS_REVIEW"
    )
    assert not detect_recurring([tx("2026-07-05"), tx("2026-09-05")], date(2026, 10, 2))


def test_end_of_month():
    result = detect_recurring(
        [tx("2026-01-31"), tx("2026-02-28"), tx("2026-03-31")], date(2026, 4, 1)
    )
    assert result[0].expected_next_date == date(2026, 4, 30)


def test_account_and_counterparty_are_not_merged():
    rows = [tx("2026-07-05"), tx("2026-08-05", account="b"), tx("2026-09-05", payee="Other")]
    assert not detect_recurring(rows, date(2026, 10, 2))


def test_amount_change_and_duplicate_month_do_not_pass():
    rows = [tx("2026-07-05"), tx("2026-08-05"), tx("2026-09-05", "-20000")]
    assert not detect_recurring(rows, date(2026, 10, 2))
    rows[-1].amount = -9000
    rows.append(tx("2026-09-06"))
    assert detect_recurring(rows, date(2026, 10, 2))[0].status == "NEEDS_REVIEW"
