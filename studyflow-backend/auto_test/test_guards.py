from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from studyflow_backend.models import Actor, Idempotency

pytestmark = pytest.mark.postgres


def test_persisted_credentials_are_only_hashes(api):
    with api.factory() as session:
        for actor in session.scalars(select(Actor)):
            assert len(actor.token_hash) == 64
            assert actor.token_hash not in api.tokens.values()


def test_ledger_order_reconciles_even_when_timestamps_identical(api):
    funded = api.disburse()
    api.ok(
        "POST",
        "/admin/wallet-topups",
        {
            "student_id": "student",
            "amount": "600",
            "reason": "same instant",
            "expected_version": funded["wallet"]["version"],
        },
        role="admin",
    )
    rows = api.ok("GET", "/wallet/ledger")["items"]
    assert [row["kind"] for row in rows] == ["DISBURSEMENT", "TOPUP"]
    balance = Decimal("0")
    for row in rows:
        balance += Decimal(row["amount"])
        assert balance == Decimal(row["balance_after"])


def test_quote_assessment_does_not_count_its_own_application_twice(api):
    quote = api.quote()
    api.application(quote)
    result = api.ok("GET", f"/loan-quotes/{quote['quote_id']}")
    assert result["assessment"]["status"] == "AFFORDABLE"
    assert result["terms"]["principal"] == "30600.00"


def test_failed_command_leaves_no_success_replay(api):
    application = api.application()
    path = f"/loan-applications/{application['application_id']}/cancel"
    response = api.request("POST", path, {"expected_version": 1}, key="failed-version")
    assert response.status_code == 409
    with api.factory() as session:
        assert session.get(Idempotency, ("student", "failed-version")) is None


def test_idempotency_and_ledger_cannot_be_overwritten(api):
    api.disburse()
    for statement in ["UPDATE ledger SET amount = amount + 1", "DELETE FROM idempotency"]:
        with pytest.raises(DBAPIError), api.engine.begin() as connection:
            connection.execute(text(statement))


def test_profile_duplicate_months_and_boolean_versions_are_rejected(api):
    duplicated = [{"month": "2026-11"}, {"month": "2026-11"}]
    assert (
        api.request(
            "PUT", "/affordability-profiles", {"expected_version": 0, "months": duplicated}
        ).status_code
        == 422
    )
    assert (
        api.request(
            "PUT", "/affordability-profiles", {"expected_version": False, "months": []}
        ).status_code
        == 422
    )
