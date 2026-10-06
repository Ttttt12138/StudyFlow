"""Executable HTTP-level demonstration with an injected clock and a dedicated database."""

from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from studyflow_backend.api import create_app
from studyflow_backend.database import seed_actor, sessions


class Demo:
    def __init__(self, engine):
        from fastapi.testclient import TestClient

        self.factory = sessions(engine)
        self.now = datetime(2026, 10, 2, 12, tzinfo=ZoneInfo("Asia/Bangkok"))
        self.run_id = uuid4().hex
        self.student_id, admin_id = "demo_student_" + self.run_id, "demo_admin_" + self.run_id
        with self.factory.begin() as session:
            self.tokens = {
                "student": seed_actor(session, self.student_id, "student"),
                "admin": seed_actor(session, admin_id, "admin"),
            }
        self.client = TestClient(create_app(engine, lambda: self.now))

    def call(self, method, path, body=None, role="student", key=None):
        response = self.client.request(
            method,
            "/api/v1" + path,
            json=body,
            headers={
                "Authorization": "Bearer " + self.tokens[role],
                "Idempotency-Key": key or uuid4().hex,
            },
        )
        if response.status_code not in {200, 201}:
            raise RuntimeError(f"{method} {path}: {response.status_code} {response.text}")
        return response.json()

    def prepare(self):
        quote = self.call(
            "POST",
            "/loan-quotes",
            {
                "principal": "30600.00",
                "annual_rate": "0",
                "fees": "600.00",
                "months": 12,
                "first_due_date": "2026-11-01",
            },
        )
        draft = self.call("POST", "/loan-applications", {"quote_id": quote["quote_id"]})
        application = self.call(
            "POST",
            f"/loan-applications/{draft['application_id']}/submit",
            {"expected_version": draft["version"]},
        )
        require(application["state"] == "UNDER_REVIEW", "Missing inputs must require review")
        return quote, application

    def approve(self, quote, application):
        months = [
            {
                "month": row["due_date"][:7],
                "income": "10000",
                "living_expenses": "4000",
                "existing_repayments": "1000",
            }
            for row in quote["repayments"]
        ]
        self.call("PUT", "/affordability-profiles", {"expected_version": 0, "months": months})
        approved = self.call(
            "POST",
            f"/admin/loan-applications/{application['application_id']}/review",
            {"expected_version": application["version"], "reason": "Demo inputs supplied"},
            role="admin",
        )
        require(approved["state"] == "APPROVED", "Complete affordable inputs must pass")
        require(self.call("GET", "/wallet")["balance"] == "0.00", "Approval must not create cash")
        return approved

    def fund(self, application):
        path = f"/admin/loan-applications/{application['application_id']}/disburse"
        body = {"expected_version": application["version"]}
        funded = self.call("POST", path, body, role="admin", key="demo-disburse")
        require(
            self.call("POST", path, body, role="admin", key="demo-disburse") == funded,
            "Replay must return the original result",
        )
        require(funded["wallet"]["balance"] == "30000.00", "Net proceeds must be exact")
        return funded

    def repay_all(self, funded):
        self.call(
            "POST",
            "/admin/wallet-topups",
            {
                "student_id": self.student_id,
                "amount": "600.00",
                "reason": "Simulated supplemental cash",
                "expected_version": funded["wallet"]["version"],
            },
            role="admin",
        )
        loan = funded["loan"]
        for installment in loan["installments"]:
            self.now = datetime.fromisoformat(installment["due_date"]).replace(
                tzinfo=self.now.tzinfo
            )
            result = self.call(
                "POST",
                f"/loans/{loan['loan_id']}/repay",
                {
                    "expected_version": loan["version"],
                    "installment_number": installment["number"],
                },
            )
            loan = result["loan"]
        require(loan["status"] == "CLOSED", "Loan must close after final installment")
        require(result["wallet"]["balance"] == "0.00", "Cash must reconcile")
        return result


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def c_check(demo, application):
    from studyflow_backend.c_adapter import explain_demo

    context, result = explain_demo(
        demo.factory, application["application_id"], demo.student_id, demo.now
    )
    if application["state"] == "DISBURSED":
        require(context.sources[0].received, "Received funds must be marked")
        require(
            all(c.validation == "INVALID" for c in result.candidates),
            "Cannot allocate received cash",
        )
    else:
        require(
            all(c.validation == "PENDING" for c in result.candidates), "B has not validated funding"
        )
    return result.model_dump(mode="json")


def run_demo(engine, with_c=False):
    demo = Demo(engine)
    try:
        quote, pending = demo.prepare()
        missing_explanation = c_check(demo, pending) if with_c else None
        approved = demo.approve(quote, pending)
        approved_explanation = c_check(demo, approved) if with_c else None
        funded = demo.fund(approved)
        funded_explanation = c_check(demo, funded["application"]) if with_c else None
        settled = demo.repay_all(funded)
        return {
            "simulated": True,
            "run_id": demo.run_id,
            "student_id": demo.student_id,
            "quote": quote,
            "pending": pending,
            "approved": approved,
            "funded": funded,
            "settled": settled,
            "ledger": demo.call("GET", "/wallet/ledger"),
            "c_integration": {
                "executed": with_c,
                "missing_inputs": missing_explanation,
                "approved": approved_explanation,
                "received": funded_explanation,
            },
        }
    finally:
        demo.client.close()
