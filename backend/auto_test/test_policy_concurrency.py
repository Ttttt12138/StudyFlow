"""Policy checks under real PostgreSQL row locks (docs/permissions.md)."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from auto_test.test_multicurrency import FX_SETTINGS, HOME, MultiCurrencyHarness
from auto_test.test_policy import PASSWORD
from finance.policy_models import ApprovalRequest, PolicyLimit, StepUpGrant
from finance.workflow_models import CurrencyConversion


@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL locking")
@override_settings(**FX_SETTINGS)
class PolicyConcurrencyTests(MultiCurrencyHarness, TransactionTestCase):
    username = "policy-parallel"

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.bootstrap()

    def step_up(self, quote_id, amount):
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v2/auth/step-up/", {
            "password": PASSWORD, "action": "wallet.convert", "target_id": quote_id, "amount": amount,
            "currency": "CNY"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["token"]

    def race(self, requests):
        """requests: [(user_id, path, body, extra headers)] posted at the same moment."""
        barrier = Barrier(len(requests))

        def work(index):
            user_id, path, body, headers = requests[index]
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=user_id))
                barrier.wait(timeout=10)
                response = client.post("/api/v2/" + path + "/", body, format="json",
                                       HTTP_IDEMPOTENCY_KEY=str(uuid4()), **headers)
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(requests)) as pool:
            return list(pool.map(work, range(len(requests))))

    def test_one_token_cannot_authorize_two_concurrent_commands(self):
        self.hold("CNY", "3000.00")
        quote = self.live("CNY", HOME, "1000.00")
        token = self.step_up(quote["id"], "1000.00")
        body = self.convert_body(quote["id"], "1000.00")
        results = self.race([(self.user.pk, "conversions", body, {"HTTP_X_STEP_UP_TOKEN": token})] * 2)
        self.assertEqual(sorted(status for status, _ in results), [201, 403], results)
        loser = next(data for status, data in results if status == 403)
        self.assertEqual(loser["detail"], "STEP_UP_INVALID")
        self.assertEqual(CurrencyConversion.objects.count(), 1)
        self.assertIsNotNone(StepUpGrant.objects.get(owner=self.user).used_at)
        self.assert_invariant()

    def test_daily_limit_holds_under_concurrent_spending(self):
        PolicyLimit.objects.filter(currency="CNY").update(per_transaction=1000, daily=1500, monthly=2000)
        self.hold("CNY", "3000.00")
        requests = []
        for _ in range(2):
            quote = self.live("CNY", HOME, "800.00")
            token = self.step_up(quote["id"], "800.00")
            requests.append((self.user.pk, "conversions", self.convert_body(quote["id"], "800.00"),
                             {"HTTP_X_STEP_UP_TOKEN": token}))
        results = self.race(requests)
        # Usage is computed under the owner lock, so the loser always sees the winner's debit.
        self.assertEqual(sorted(status for status, _ in results), [201, 403], results)
        loser = next(data for status, data in results if status == 403)
        self.assertEqual(loser["detail"], "APPROVAL_REQUIRED")
        self.assertEqual(loser["policy"]["usage"]["daily"], "800.00")
        self.assertEqual(CurrencyConversion.objects.count(), 1)
        self.assert_invariant()

    def test_concurrent_decisions_have_one_winner(self):
        quote = self.live("CNY", HOME, "1000.00")
        self.client.force_authenticate(self.user)
        approval = self.client.post("/api/v2/approvals/", {
            "action": "wallet.convert", "target_id": quote["id"], "amount": "1000.00", "currency": "CNY",
            "reason": "Large conversion"}, format="json").data["data"]
        second = get_user_model().objects.create_user(username="policy-parallel-approver-2", is_staff=True)
        body = {"decision": "approve", "note": "ok", "expected_version": approval["version"]}
        path = "approvals/" + approval["id"] + "/decide"
        results = self.race([(self.approver.pk, path, body, {}), (second.pk, path, body, {})])
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        stored = ApprovalRequest.objects.get(pk=approval["id"])
        self.assertEqual((stored.status, stored.version), ("APPROVED", 2))
