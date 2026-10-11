from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections
from rest_framework.test import APIClient, APITransactionTestCase

from finance.lending_models import LoanAccount
from finance.workflow_models import DemoLedgerEntry

from .test_lending_merge import LendingHarness


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class LendingConcurrencyTests(LendingHarness, APITransactionTestCase):
    def parallel(self, path, body, *, operator=False, same_key=False):
        actor_id = (self.operator if operator else self.student).pk
        barrier, key = Barrier(4), str(uuid4())
        # One step-up per request, obtained before the race.
        headers = [{} if operator else self.step_up(path, body) for _ in range(4)]

        def work(index):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=actor_id))
                barrier.wait(timeout=10)
                response = client.post(
                    "/api/v2/" + path + "/",
                    body,
                    format="json",
                    HTTP_IDEMPOTENCY_KEY=key if same_key else str(uuid4()),
                    **headers[index],
                )
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=4) as pool:
            return sorted(pool.map(work, range(4)))

    def test_simultaneous_disbursement_has_one_credit(self):
        loan, _, path = self.prepare()
        self.profile(loan)
        application = self.review(path)
        statuses = self.parallel(
            path + "/disburse",
            {"expected_version": application["version"]},
            operator=True,
        )
        self.assertEqual(statuses, [201, 409, 409, 409])
        self.assertEqual(LoanAccount.objects.count(), 1)
        self.assertEqual(DemoLedgerEntry.objects.count(), 1)

    def test_same_key_repayment_replays_once(self):
        _, _, _, account = self.fund()
        self.post("demo/clock", {"date": "2026-11-01"})
        statuses = self.parallel(
            "loan-accounts/" + account["id"] + "/repay",
            {"expected_version": 1, "installment_number": 1},
            same_key=True,
        )
        self.assertEqual(statuses, [200, 200, 200, 201])
        self.assertEqual(DemoLedgerEntry.objects.count(), 2)
        self.assertEqual(LoanAccount.objects.get(pk=account["id"]).version, 2)

    def test_different_key_repayment_cannot_double_debit(self):
        _, _, _, account = self.fund()
        self.post("demo/clock", {"date": "2026-11-01"})
        statuses = self.parallel(
            "loan-accounts/" + account["id"] + "/repay",
            {"expected_version": 1, "installment_number": 1},
        )
        self.assertEqual(statuses, [201, 409, 409, 409])
        self.assertEqual(DemoLedgerEntry.objects.count(), 2)
