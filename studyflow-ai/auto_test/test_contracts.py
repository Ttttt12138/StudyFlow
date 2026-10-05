from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from studyflow_ai.models import CandidateEvent, Evidence, FinancialSnapshot, Transaction


def test_amount_serializes_as_two_decimal_string():
    event = CandidateEvent(category="tuition", amount="65000", currency="THB")
    assert event.model_dump(mode="json")["amount"] == "65000.00"


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "0.001"])
def test_invalid_money_rejected(amount):
    with pytest.raises(ValidationError):
        CandidateEvent(category="tuition", amount=amount)


def test_verified_requires_evidence_of_verification():
    with pytest.raises(ValidationError):
        CandidateEvent(category="tuition", confidence_type="VERIFIED")


def test_transaction_preserves_sign():
    tx = Transaction(
        account_id="a",
        date=date(2026, 9, 5),
        amount="-9000",
        counterparty="Condo",
        description="rent",
    )
    assert tx.amount == Decimal("-9000")


def test_snapshot_requires_timezone():
    with pytest.raises(ValidationError):
        FinancialSnapshot(
            student_id="s",
            state_version=1,
            as_of="2026-10-02T20:00:00",
            balance="80000",
            minimum_reserve="15000",
        )


def test_evidence_locators_are_explicit():
    evidence = Evidence(source_id="s", field="amount", quote="THB 65000", locator="page:1")
    assert evidence.locator == "page:1"
