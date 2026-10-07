from copy import deepcopy
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from finance.models import FinancialState
from finance.policy_defaults import ensure_default_limits
from finance.policy_flow import client_flow, step_up_header
from finance.workflow_models import DemoLedgerEntry, DemoWallet, Disbursement

TERMS = {
    "currency": "THB",
    "principal": "30600.00",
    "annual_rate": "0",
    "months": 12,
    "fees": "600.00",
    "first_due_date": "2026-11-01",
}
PASSWORD = "merge-student-pass-1"
SNAPSHOT = {
    "currency": "THB",
    "as_of": "2026-10-02",
    "opening_balance": "600.00",
    "reserve": "0.00",
    "events": [],
}


class LendingHarness:
    def setUp(self):
        ensure_default_limits()
        users = get_user_model().objects
        self.student = users.create_user(username="merge-student", password=PASSWORD)
        self.operator = users.create_user(username="merge-operator", is_staff=True)
        self.other = users.create_user(username="merge-other")
        self.flow = client_flow(self.student, PASSWORD)
        self.post("state", {"expected_version": 0, "snapshot": deepcopy(SNAPSHOT)})
        self.post("demo/initialize", {"state_version": 1})

    def step_up(self, path, data):
        """Repayments are T2: re-authenticate through POST auth/step-up/ first."""
        return step_up_header(self.flow, path, data)

    def post(self, path, data, *, operator=False, code=201, key=None):
        headers = {} if operator else self.step_up(path, data)
        self.client.force_authenticate(self.operator if operator else self.student)
        response = self.client.post(
            "/api/v2/" + path + "/",
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key or str(uuid4()),
            **headers,
        )
        self.assertEqual(response.status_code, code, response.data)
        return response.data.get("data", response.data)

    def get(self, path, *, actor=None, code=200):
        self.client.force_authenticate(actor or self.student)
        response = self.client.get("/api/v2/" + path + "/")
        self.assertEqual(response.status_code, code, response.data)
        return response.data.get("data", response.data)

    def prepare(self, **changes):
        loan = self.post("loans", {**TERMS, **changes})
        application = self.post("applications", {"quote_id": loan["id"]})
        path = "applications/" + application["id"]
        self.post(path + "/action", {"action": "submit", "expected_version": 1})
        return loan, application, path

    def profile(self, loan, income="10000.00"):
        current = self.get("affordability-profile")
        months = [
            {
                "month": row["due_date"][:7],
                "income": income,
                "living_expenses": "4000.00",
                "existing_repayments": "1000.00",
            }
            for row in loan["result"]["schedule"]
            if Decimal(row["payment"]) > 0
        ]
        return self.post(
            "affordability-profile",
            {
                "expected_version": current["version"],
                "months": months,
            },
        )

    def review(self, path):
        return self.post(
            path + "/decision",
            {
                "expected_version": self.get(path)["version"],
                "reason": "Review supplied inputs",
            },
            operator=True,
        )

    def fund(self):
        loan, app, path = self.prepare()
        self.profile(loan)
        approved = self.review(path)
        route = path + "/disburse"
        result = self.post(
            route,
            {"expected_version": approved["version"]},
            operator=True,
            key="settle",
        )
        return loan, app, route, result["account"]


class LendingMergeTests(LendingHarness, APITestCase):
    def test_missing_profile_cannot_be_overridden_by_operator(self):
        loan, _, path = self.prepare()
        self.assertEqual(self.review(path)["status"], "UNDER_REVIEW")
        self.post(
            path + "/decision",
            {"action": "approve", "expected_version": 3, "reason": "Override"},
            operator=True,
            code=400,
        )
        self.assertEqual(Disbursement.objects.count(), 0)
        self.profile(loan)
        self.assertEqual(self.review(path)["status"], "APPROVED")
        self.assertEqual(
            DemoWallet.objects.get(owner=self.student).balance, Decimal("600")
        )
        self.assertEqual(DemoLedgerEntry.objects.count(), 0)

    def test_other_approved_loan_consumes_capacity(self):
        loan, _, path = self.prepare()
        self.profile(loan)
        self.assertEqual(self.review(path)["status"], "APPROVED")
        _, _, second_path = self.prepare()
        self.assertEqual(self.get(second_path)["status"], "REJECTED")

    def test_changed_profile_returns_disbursement_to_review(self):
        loan, _, path = self.prepare()
        self.profile(loan)
        approved = self.review(path)
        self.profile(loan, income="5000.00")
        self.post(
            path + "/disburse", {"expected_version": approved["version"]}, operator=True
        )
        self.assertEqual(self.get(path)["status"], "UNDER_REVIEW")
        self.assertEqual(DemoLedgerEntry.objects.count(), 0)
        self.profile(loan)
        approved = self.review(path)
        self.post(
            path + "/disburse", {"expected_version": approved["version"]}, operator=True
        )
        self.assertEqual(DemoLedgerEntry.objects.count(), 1)

    # Twelve installments (plus replays) are repaid within seconds of real time here, which is
    # beyond the 10/hour step-up budget a real student would ever need.
    @override_settings(STUDYFLOW_THROTTLE_RATES={**settings.STUDYFLOW_THROTTLE_RATES, "step_up": "60/hour"})
    def test_repayment_lifecycle_and_idempotency(self):
        _, _, route, account = self.fund()
        self.post(route, {"expected_version": 3}, operator=True, code=200, key="settle")
        path = "loan-accounts/" + account["id"]
        repayment = {"expected_version": 1, "installment_number": 1}
        self.post(path + "/repay", repayment, code=400)
        self.post("demo/clock", {"date": "2027-10-01"})
        detail = self.get(path)
        self.assertEqual(detail["installments"][0]["status"], "OVERDUE")
        self.post(path + "/repay", {**repayment, "installment_number": 2}, code=400)
        for number in range(1, 13):
            body = {
                "expected_version": account["version"],
                "installment_number": number,
            }
            result = self.post(path + "/repay", body, key="repay-" + str(number))
            replay = self.post(
                path + "/repay", body, key="repay-" + str(number), code=200
            )
            self.assertEqual(replay, result)
            account = result["account"]
        self.assertEqual(account["status"], "CLOSED")
        self.assertEqual(account["outstanding_principal"], "0.00")
        self.assertEqual(DemoWallet.objects.get(owner=self.student).balance, 0)
        self.assertEqual(DemoLedgerEntry.objects.count(), 13)
        events = (
            FinancialState.objects.filter(owner=self.student).first().snapshot["events"]
        )
        self.assertEqual(
            len([event for event in events if "settled_sequence" in event]), 13
        )

    def test_repayment_stale_version_ownership_and_rollback(self):
        _, _, _, account = self.fund()
        path = "loan-accounts/" + account["id"]
        self.get(path, actor=self.other, code=404)
        self.post("demo/clock", {"date": "2026-11-01"})
        self.post(
            path + "/repay", {"expected_version": 0, "installment_number": 1}, code=409
        )
        before = DemoWallet.objects.get(owner=self.student).balance
        with patch(
            "finance.workflow_common.AuditEvent.objects.create",
            side_effect=RuntimeError("fault"),
        ):
            with self.assertRaises(RuntimeError):
                self.post(
                    path + "/repay", {"expected_version": 1, "installment_number": 1}
                )
        self.assertEqual(DemoWallet.objects.get(owner=self.student).balance, before)
        self.assertEqual(self.get(path)["version"], 1)
        self.assertEqual(DemoLedgerEntry.objects.count(), 1)

    def test_profile_version_and_incomplete_months(self):
        loan, _, path = self.prepare()
        self.profile(loan)
        self.post(
            "affordability-profile", {"expected_version": 0, "months": []}, code=409
        )
        self.post("affordability-profile", {"expected_version": 1, "months": []})
        self.assertEqual(self.review(path)["status"], "UNDER_REVIEW")

    def test_c_export_preserves_quote_and_actual_receipt_date(self):
        loan, app, _, _ = self.fund()
        path = "applications/" + app["id"] + "/c-context"
        exported = self.get(path)
        self.assertEqual(exported["quote"]["principal"]["amount"], "30600.00")
        self.assertEqual(
            exported["quote"]["repayments"][0]["amount"]["amount"], "2550.00"
        )
        self.assertEqual(exported["source"]["allocatable"]["amount"], "0.00")
        self.assertEqual(exported["application"]["state"], "DISBURSED")
        self.post("demo/clock", {"date": "2026-10-20"})
        self.assertEqual(self.get(path)["source"]["available_date"], "2026-10-02")
        self.assertEqual(self.get(path)["quote"]["quote_id"], loan["id"])
        self.get(path, actor=self.other, code=404)

    def test_tiny_loan_and_float_amount_are_rejected(self):
        self.post("loans", {**TERMS, "principal": "0.01", "fees": "0"}, code=400)
        self.post("loans", {**TERMS, "principal": 30600.1}, code=400)
