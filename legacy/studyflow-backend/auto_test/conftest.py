import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from studyflow_backend.api import create_app
from studyflow_backend.database import seed_actor, sessions


@pytest.fixture
def pg_engine():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL required for real PostgreSQL integration tests")
    parsed = make_url(url)
    if parsed.get_backend_name() != "postgresql" or not parsed.database.endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must point to a PostgreSQL database ending in _test")
    schema = "test_" + uuid4().hex
    root = create_engine(url)
    with root.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    yield engine
    engine.dispose()
    with root.begin() as connection:
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    root.dispose()


class Harness:
    def __init__(self, engine):
        self.clock = datetime(2026, 10, 2, 12, tzinfo=ZoneInfo("Asia/Bangkok"))
        self.engine = engine
        self.factory = sessions(engine)
        with self.factory.begin() as session:
            self.tokens = {
                role: seed_actor(session, role, "admin" if role == "admin" else "student")
                for role in ("student", "other", "admin")
            }
        self.app = create_app(engine, lambda: self.clock)
        self.client = TestClient(self.app)

    def request(self, method, path, body=None, role="student", key=None):
        headers = {"Authorization": "Bearer " + self.tokens[role]}
        if method not in {"GET", "HEAD"}:
            headers["Idempotency-Key"] = key or uuid4().hex
        return self.client.request(method, "/api/v1" + path, json=body, headers=headers)

    def ok(self, method, path, body=None, **kwargs):
        response = self.request(method, path, body, **kwargs)
        assert response.status_code in (200, 201), response.text
        return response.json()

    def quote(self, **changes):
        body = {
            "principal": "30600",
            "fees": "600",
            "annual_rate": "0",
            "months": 12,
            "first_due_date": "2026-11-01",
        }
        body.update(changes)
        return self.ok("POST", "/loan-quotes", body)

    def profile(self, quote, income="10000"):
        current = self.ok("GET", "/affordability-profiles")
        months = [
            {
                "month": r["due_date"][:7],
                "income": income,
                "living_expenses": "4000",
                "existing_repayments": "1000",
            }
            for r in quote["repayments"]
        ]
        return self.ok(
            "PUT",
            "/affordability-profiles",
            {"expected_version": current["version"], "months": months},
        )

    def application(self, quote=None, with_profile=True):
        quote = quote or self.quote()
        if with_profile:
            self.profile(quote)
        draft = self.ok("POST", "/loan-applications", {"quote_id": quote["quote_id"]})
        return self.ok(
            "POST",
            f"/loan-applications/{draft['application_id']}/submit",
            {"expected_version": draft["version"]},
        )

    def disburse(self, application=None, **kwargs):
        application = application or self.application()
        return self.ok(
            "POST",
            f"/admin/loan-applications/{application['application_id']}/disburse",
            {"expected_version": application["version"]},
            role="admin",
            **kwargs,
        )


@pytest.fixture
def api(pg_engine):
    harness = Harness(pg_engine)
    yield harness
    harness.client.close()
