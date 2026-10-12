"""PostgreSQL concurrency tests for docs/remittance.md (real threads, real row locks)."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from auto_test.test_multicurrency import FX_SETTINGS, HOME, OPENING
from auto_test.test_remittance import RemittanceHarness
from finance.workflow_models import DemoLedgerEntry, FXQuote


@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL locking")
# The transition matrix submits dozens of orders in seconds; throttling itself is
# covered by auto_test/test_policy.py, so these suites raise the step-up/money rates.
@override_settings(**FX_SETTINGS, STUDYFLOW_THROTTLE_RATES={
    **settings.STUDYFLOW_THROTTLE_RATES, "step_up": "1000/hour", "money": "1000/hour"})
class RemittanceConcurrencyTests(RemittanceHarness, TransactionTestCase):
    username = "rm-parallel"

    def setUp(self):
        self.client = APIClient()
        self.bootstrap()

    def race(self, calls, actor=None):
        """Run calls[i](client) concurrently, each on its own connection; [(status, data)] in order."""
        barrier = Barrier(len(calls))
        actor_ids = [(a or self.user).pk for a in (actor if isinstance(actor, list) else [actor] * len(calls))]

        def work(index):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=actor_ids[index]))
                barrier.wait(timeout=10)
                response = calls[index](client)
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(work, range(len(calls))))

    def submit_call(self, order, version):
        return lambda client: self.submit(order, version, code=None, client=client)

    def adapter_call(self, order, outcome, version, note=""):
        path = "/api/v2/remittance-orders/" + order["id"] + "/adapter-event/"
        body = {"outcome": outcome, "expected_version": version, "note": note}
        return lambda client: client.post(path, body, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))

    def debits(self, order=None):
        rows = DemoLedgerEntry.objects.filter(remittance_leg="debit")
        return rows.filter(remittance_order_id=order["id"]) if order else rows.filter(owner=self.user)

    # ------------------------------------------------------------------ submit
    def test_same_order_submitted_twice_concurrently_debits_once(self):
        order, quote = self.new_order(amount="1000.00")
        self.fund_foreign("CNY", "1000.00")  # enough for two debits if the guard failed
        results = self.race([self.submit_call(order, 1), self.submit_call(order, 1)])
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses[0], 201, results)
        # Loser is an idempotent replay (current order) or a version conflict; never a second effect.
        self.assertIn(statuses[1], {200, 201, 409}, results)
        self.assertEqual(self.debits(order).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        row = self.db(order)
        self.assertEqual((row.status, row.version), ("SUBMITTED", 2))
        self.assertEqual(self.history_rows(order), [("", "CREATED", 1), ("CREATED", "SUBMITTED", 2)])
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        self.assert_invariant()

    def test_same_submit_idempotency_key_concurrently_posts_once(self):
        order, _ = self.new_order(amount="1000.00")
        calls = [lambda c: self.submit(order, 1, code=None, client=c, key="same-submit")] * 2
        results = self.race(calls)
        self.assertEqual(sorted(status for status, _ in results), [200, 201], results)
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(self.debits(order).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("0.00"))
        self.assert_invariant()

    def test_two_orders_cannot_overdraw_the_same_balance(self):
        self.fund_foreign("CNY", "1000.00")
        first, _ = self.new_order(amount="800.00", fund=False)
        second, _ = self.new_order(amount="800.00", fund=False)
        results = self.race([self.submit_call(first, 1), self.submit_call(second, 1)])
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses, [201, 400], results)
        loser = next(data for status, data in results if status == 400)
        self.assertIn("INSUFFICIENT_BALANCE", str(loser))
        self.assertEqual(self.foreign("CNY"), Decimal("200.00"))
        self.assertEqual(sorted(self.db(o).status for o in (first, second)), ["CREATED", "SUBMITTED"])
        self.assertEqual(self.debits().count(), 1)
        self.assertEqual(FXQuote.objects.filter(owner=self.user, consumed_at__isnull=False).count(), 1)
        self.assert_invariant()

    def test_many_orders_draining_one_balance_never_go_negative(self):
        self.fund_foreign("CNY", "1000.00")
        orders = [self.new_order(amount="300.00", fund=False)[0] for _ in range(4)]
        results = self.race([self.submit_call(o, 1) for o in orders])
        wins = sum(status == 201 for status, _ in results)
        self.assertTrue(all(status in {201, 400} for status, _ in results), results)
        self.assertEqual(wins, 3, results)  # 3 x 300 fits in 1000, a 4th never does
        self.assertEqual(self.foreign("CNY"), Decimal("100.00"))
        self.assertEqual(self.debits().count(), wins)
        self.assertEqual(sum(self.db(o).status == "SUBMITTED" for o in orders), wins)
        self.assert_invariant()

    def test_home_orders_racing_cannot_both_spend_the_reserve(self):
        # 80000 opening, 15000 reserve: either 40000 order fits alone, not both.
        first, _ = self.new_order(HOME, amount="40000.00")
        second, _ = self.new_order(HOME, amount="40000.00")
        results = self.race([self.submit_call(first, 1), self.submit_call(second, 1)])
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses, [201, 400], results)
        self.assertIn("RESERVE_REQUIRED", str(next(d for s, d in results if s == 400)))
        self.assertEqual(self.home(), OPENING - Decimal("40000.00"))
        self.assertEqual(len(self.remittance_events()), 1)
        self.assert_invariant()

    def test_cancel_racing_submit_has_exactly_one_outcome(self):
        order, _ = self.new_order(amount="1000.00")
        cancel_path = "/api/v2/remittance-orders/" + order["id"] + "/cancel/"
        cancel = lambda c: c.post(cancel_path, {"expected_version": 1}, format="json",
                                  HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        results = self.race([self.submit_call(order, 1), cancel])
        row = self.db(order)
        self.assertIn(row.status, {"SUBMITTED", "CANCELLED"})
        self.assertEqual(row.version, 2)
        self.assertEqual(self.debits(order).count(), 1 if row.status == "SUBMITTED" else 0)
        self.assertEqual(self.foreign("CNY"), Decimal("0.00") if row.status == "SUBMITTED" else Decimal("1000.00"))
        self.assertEqual(len(self.history_rows(order)), 2)
        self.assertEqual(sorted(s for s, _ in results)[0], 201, results)
        self.assert_invariant()

    # ------------------------------------------------------------------ adapter callbacks
    def test_duplicate_failed_callbacks_refund_once(self):
        order = self.drive("SUBMITTED")
        results = self.race([self.adapter_call(order, "failed", 2, "dup")] * 2, actor=self.operator)
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses[0], 201, results)
        self.assertIn(statuses[1], {200, 201, 409}, results)
        refunds = DemoLedgerEntry.objects.filter(remittance_order_id=order["id"], remittance_leg="refund")
        self.assertEqual(refunds.count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        row = self.db(order)
        self.assertEqual((row.status, row.version), ("REFUNDED", 3))
        self.assertEqual([r[1] for r in self.history_rows(order)].count("REFUNDED"), 1)
        self.assert_invariant()

    def test_duplicate_delivered_callbacks_credit_once(self):
        order = self.drive("IN_TRANSIT")
        results = self.race([self.adapter_call(order, "delivered", 3)] * 3, actor=self.operator)
        self.assertEqual(sorted(s for s, _ in results)[0], 201, results)
        self.assertTrue(all(s in {200, 201, 409} for s, _ in results), results)
        credits = DemoLedgerEntry.objects.filter(remittance_order_id=order["id"], remittance_leg="credit")
        self.assertEqual(credits.count(), 1)
        self.assertEqual(self.home(), OPENING + self.db(order).receive_amount)
        self.assertEqual(len(self.remittance_events(order)), 1)  # one :credit event
        self.assertEqual(self.db(order).version, 4)
        self.assert_invariant()

    def test_conflicting_delivered_and_failed_callbacks_settle_one_way(self):
        order = self.drive("UNKNOWN")
        results = self.race([self.adapter_call(order, "delivered", 3), self.adapter_call(order, "failed", 3)],
                            actor=self.operator)
        row = self.db(order)
        legs = set(self.legs(order))
        self.assertIn(row.status, {"DELIVERED", "REFUNDED"}, results)
        self.assertEqual(legs, {"debit", "credit"} if row.status == "DELIVERED" else {"debit", "refund"})
        self.assertEqual(row.version, 4)
        statuses = sorted(s for s, _ in results)
        self.assertEqual(statuses[0], 201, results)
        self.assertIn(statuses[1], {400, 409}, results)
        self.assert_invariant()
