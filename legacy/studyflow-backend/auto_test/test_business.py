from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from studyflow_backend.models import Audit, Installment, Ledger, Loan, Wallet

pytestmark = pytest.mark.postgres


def test_missing_review_then_approve_without_cash(api):
    quote = api.quote()
    application = api.application(quote, with_profile=False)
    assert application["state"] == "UNDER_REVIEW"
    api.profile(quote)
    approved = api.ok(
        "POST",
        f"/admin/loan-applications/{application['application_id']}/review",
        {"expected_version": application["version"], "reason": "Inputs supplied"},
        role="admin",
    )
    assert approved["state"] == "APPROVED"
    assert api.ok("GET", "/wallet")["balance"] == "0.00"
    disbursed = api.disburse(approved)
    assert disbursed["wallet"]["balance"] == "30000.00"
    assert disbursed["loan"]["outstanding_principal"] == "30600.00"


def test_insufficient_capacity_rejected_and_not_overridable(api):
    quote = api.quote()
    api.profile(quote, "5000")
    application = api.application(quote, with_profile=False)
    assert application["state"] == "REJECTED"
    response = api.request(
        "POST",
        f"/admin/loan-applications/{application['application_id']}/disburse",
        {"expected_version": application["version"]},
        role="admin",
    )
    assert response.json()["error"]["code"] == "INVALID_STATE"


def test_changed_profile_returns_to_review_without_cash(api):
    quote = api.quote()
    application = api.application(quote)
    api.profile(quote, "5000")
    result = api.disburse(application)
    assert result["application"]["state"] == "UNDER_REVIEW"
    assert result["loan"] is None
    assert api.ok("GET", "/wallet")["balance"] == "0.00"


def test_past_first_installment_prevents_disbursement(api):
    application = api.application()
    api.clock = datetime(2026, 11, 1, tzinfo=ZoneInfo("Asia/Bangkok"))
    response = api.request(
        "POST",
        f"/admin/loan-applications/{application['application_id']}/disburse",
        {"expected_version": application["version"]},
        role="admin",
    )
    assert response.json()["error"]["code"] == "QUOTE_EXPIRED"
    assert api.ok("GET", "/wallet")["balance"] == "0.00"


def test_cancel_and_version_guard(api):
    application = api.application()
    path = f"/loan-applications/{application['application_id']}/cancel"
    assert api.request("POST", path, {"expected_version": 1}).status_code == 409
    result = api.ok("POST", path, {"expected_version": application["version"]})
    assert result["state"] == "CANCELLED"
    assert api.request("POST", path, {"expected_version": result["version"]}).status_code == 409


def test_monthly_repayment_insufficient_balance_then_close(api):
    result = api.disburse()
    loan = result["loan"]
    path = f"/loans/{loan['loan_id']}/repay"
    assert (
        api.request("POST", path, {"expected_version": 1, "installment_number": 1}).json()["error"][
            "code"
        ]
        == "INSTALLMENT_NOT_DUE"
    )
    api.clock = datetime(2027, 10, 2, tzinfo=ZoneInfo("Asia/Bangkok"))
    assert api.ok("GET", f"/loans/{loan['loan_id']}")["installments"][0]["status"] == "OVERDUE"
    assert (
        api.request("POST", path, {"expected_version": 1, "installment_number": 2}).status_code
        == 409
    )
    for number in range(1, 12):
        loan = api.ok(
            "POST", path, {"expected_version": loan["version"], "installment_number": number}
        )["loan"]
    failure = api.request(
        "POST", path, {"expected_version": loan["version"], "installment_number": 12}
    )
    assert failure.json()["error"]["code"] == "INSUFFICIENT_BALANCE"
    wallet = api.ok("GET", "/wallet")
    assert wallet["balance"] == "1950.00"
    api.ok(
        "POST",
        "/admin/wallet-topups",
        {
            "expected_version": wallet["version"],
            "student_id": "student",
            "amount": "600",
            "reason": "Simulated income",
        },
        role="admin",
    )
    result = api.ok("POST", path, {"expected_version": loan["version"], "installment_number": 12})
    assert result["loan"]["status"] == "CLOSED"
    assert result["loan"]["outstanding_principal"] == "0.00"
    assert result["wallet"]["balance"] == "0.00"
    with api.factory() as session:
        assert session.scalar(select(func.count()).select_from(Ledger)) == 14
        assert session.scalar(select(func.sum(Ledger.amount))) == Decimal("0.00")
        assert (
            session.scalar(
                select(func.count())
                .select_from(Installment)
                .where(Installment.paid_at.is_not(None))
            )
            == 12
        )


def test_other_approved_loans_count_toward_capacity(api):
    first = api.application()
    assert first["state"] == "APPROVED"
    second = api.application()
    assert second["state"] == "REJECTED"


def test_failure_rolls_back_cash_debt_audit_and_idempotency(api, monkeypatch):
    from studyflow_backend import lending

    application = api.application()
    before = api.ok("GET", "/wallet")
    with api.factory() as session:
        audit_count = session.scalar(select(func.count()).select_from(Audit))
    original = lending.event

    def fail(*args, **kwargs):
        raise RuntimeError("injected failure after cash mutation")

    monkeypatch.setattr(lending, "event", fail)
    with pytest.raises(RuntimeError, match="injected failure"):
        api.disburse(application, key="rollback")
    with api.factory() as session:
        assert session.get(Wallet, "student").balance == 0
        assert session.scalar(select(func.count()).select_from(Loan)) == 0
        assert session.scalar(select(func.count()).select_from(Ledger)) == 0
        assert session.scalar(select(func.count()).select_from(Audit)) == audit_count
    assert api.ok("GET", "/wallet") == before
    monkeypatch.setattr(lending, "event", original)
    assert api.disburse(application, key="rollback")["wallet"]["balance"] == "30000.00"
