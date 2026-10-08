from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from studyflow_backend.api import create_app
from studyflow_backend.models import Audit, Ledger, Loan, Wallet

pytestmark = pytest.mark.postgres


def race(call, count=4):
    barrier = Barrier(count)

    def worker(index):
        barrier.wait(timeout=10)
        return call(index)

    with ThreadPoolExecutor(max_workers=count) as executor:
        return list(executor.map(worker, range(count)))


@pytest.mark.parametrize("same_key", [True, False])
def test_concurrent_disbursement_exactly_once(api, same_key):
    application = api.application()
    path = f"/admin/loan-applications/{application['application_id']}/disburse"
    responses = race(
        lambda i: api.request(
            "POST",
            path,
            {"expected_version": application["version"]},
            role="admin",
            key="shared" if same_key else str(i),
        )
    )
    assert sum(r.status_code == 200 for r in responses) == (4 if same_key else 1)
    assert all(r.status_code in {200, 409} for r in responses)
    with api.factory() as session:
        assert session.get(Wallet, "student").balance == 30000
        assert session.scalar(select(func.count()).select_from(Loan)) == 1
        assert session.scalar(select(func.count()).select_from(Ledger)) == 1


@pytest.mark.parametrize("same_key", [True, False])
def test_concurrent_repayment_exactly_once(api, same_key):
    loan = api.disburse()["loan"]
    api.clock = datetime(2026, 11, 1, tzinfo=ZoneInfo("Asia/Bangkok"))
    path = f"/loans/{loan['loan_id']}/repay"
    body = {"expected_version": loan["version"], "installment_number": 1}
    responses = race(
        lambda i: api.request("POST", path, body, key="shared" if same_key else str(i))
    )
    assert sum(r.status_code == 200 for r in responses) == (4 if same_key else 1)
    with api.factory() as session:
        assert session.get(Wallet, "student").balance == 27450
        assert (
            session.scalar(
                select(func.count()).select_from(Ledger).where(Ledger.kind == "REPAYMENT")
            )
            == 1
        )
    fresh = {**body, "expected_version": 2}
    assert api.request("POST", path, fresh).json()["error"]["code"] == "INSTALLMENT_NOT_PAYABLE"


def test_new_app_and_connection_pool_replay_persistent_result(api):
    application = api.application()
    result = api.disburse(application, key="persistent")
    api.engine.dispose()
    with TestClient(create_app(api.engine, lambda: api.clock)) as client:
        response = client.post(
            f"/api/v1/admin/loan-applications/{application['application_id']}/disburse",
            json={"expected_version": application["version"]},
            headers={
                "Authorization": "Bearer " + api.tokens["admin"],
                "Idempotency-Key": "persistent",
            },
        )
    assert response.json() == result
    assert api.ok("GET", "/wallet")["balance"] == "30000.00"


@pytest.mark.parametrize("table", ["ledger", "audit", "quotes"])
def test_database_rejects_mutation_of_immutable_records(api, table):
    api.disburse()
    with pytest.raises(DBAPIError), api.engine.begin() as connection:
        connection.execute(text(f"DELETE FROM {table}"))
    with api.factory() as session:
        assert session.scalar(select(func.count()).select_from(Audit)) > 0
