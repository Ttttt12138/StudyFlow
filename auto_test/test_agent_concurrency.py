"""PostgreSQL concurrency tests for agent pending actions and sessions (docs/agent.md).

Real threads, each on its own DB connection (closed when the thread ends), real row locks.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from auto_test.test_agent import THROTTLE, AgentHarness, StubPlanner, call, final
from auto_test.test_multicurrency import FX_SETTINGS, PASSWORD
from finance import agent_runner
from finance.agent_models import AgentPendingAction, AgentSession, AgentStep
from finance.policy_flow import client_flow
from finance.policy_models import StepUpGrant


@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL locking")
@override_settings(**FX_SETTINGS, STUDYFLOW_AI_MODE="mock", STUDYFLOW_THROTTLE_RATES=THROTTLE)
class AgentConcurrencyTests(AgentHarness, TransactionTestCase):
    username = "ag-parallel"

    def setUp(self):
        cache.clear()  # throttle counters live in the DB cache, which flush does not empty
        self.client = APIClient()
        self.bootstrap()

    def race(self, calls):
        """Run calls[i](client) concurrently, each on its own connection; [(status, data)] in order."""
        barrier = Barrier(len(calls))
        user_id = self.user.pk

        def work(index):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=user_id))
                barrier.wait(timeout=10)
                response = calls[index](client)
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(work, range(len(calls))))

    def token(self, route, body=None):
        """A fresh single-use step-up token for `route`, obtained through the API."""
        token = client_flow(self.user, PASSWORD, self.approver).token(route, body or {})
        self.assertTrue(token)
        return token

    def confirm_call(self, pending, token, key=None):
        path = "/api/v2/" + self.confirm_path(pending) + "/"
        return lambda c: c.post(path, {}, format="json", HTTP_IDEMPOTENCY_KEY=key or str(uuid4()),
                                HTTP_X_STEP_UP_TOKEN=token)

    def reject_call(self, pending):
        path = "/api/v2/agent/pending-actions/" + self.oid(pending) + "/reject/"
        return lambda c: c.post(path, {}, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))

    # ------------------------------------------------------------------ confirm races
    def test_two_confirms_of_same_pending_action_debit_once(self):
        order, _ = self.new_order(amount="1000.00")
        self.fund_foreign("CNY", "1000.00")  # room for a second debit if the guard failed
        pending = self.propose_submit(order)
        route = self.confirm_path(pending)
        tokens = [self.token(route), self.token(route)]
        results = self.race([self.confirm_call(pending, t) for t in tokens])
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses[0], 201, results)
        self.assertIn(statuses[1], {200, 201, 400, 409}, results)
        self.assertEqual(self.debits(order).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertEqual(self.pending_row(pending).status, "CONFIRMED")
        self.assertEqual((self.db(order).status, self.db(order).version), ("SUBMITTED", 2))
        used = StepUpGrant.objects.filter(owner=self.user, target_id=self.oid(order), used_at__isnull=False)
        self.assertEqual(used.count(), 1)
        self.assert_invariant()

    def test_same_confirm_key_concurrently_executes_once(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        route = self.confirm_path(pending)
        tokens = [self.token(route), self.token(route)]
        results = self.race([self.confirm_call(pending, t, key="same-confirm") for t in tokens])
        self.assertEqual(sorted(status for status, _ in results), [200, 201], results)
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(self.debits(order).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("0.00"))
        self.assert_invariant()

    def test_confirm_racing_reject_has_exactly_one_outcome(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        token = self.token(self.confirm_path(pending))
        results = self.race([self.confirm_call(pending, token), self.reject_call(pending)])
        row = self.pending_row(pending)
        self.assertIn(row.status, {"CONFIRMED", "REJECTED"}, results)
        self.assertEqual(row.version, 2)
        if row.status == "CONFIRMED":
            self.assertEqual(self.debits(order).count(), 1)
            self.assertEqual(self.db(order).status, "SUBMITTED")
        else:
            self.assertEqual(self.debits(order).count(), 0)
            self.assertEqual(self.db(order).status, "CREATED")
            self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
            self.assertIn("PENDING_ACTION_CLOSED", str(results[0][1]))
        self.assert_invariant()

    def test_confirm_racing_direct_submit_debits_once(self):
        order, _ = self.new_order(amount="1000.00")
        self.fund_foreign("CNY", "1000.00")
        pending = self.propose_submit(order)
        confirm_token = self.token(self.confirm_path(pending))
        submit_route = "remittance-orders/" + self.oid(order) + "/submit"
        submit_token = self.token(submit_route, {"expected_version": 1})
        submit = lambda c: c.post("/api/v2/" + submit_route + "/", {"expected_version": 1}, format="json",
                                  HTTP_IDEMPOTENCY_KEY=str(uuid4()), HTTP_X_STEP_UP_TOKEN=submit_token)
        results = self.race([self.confirm_call(pending, confirm_token), submit])
        self.assertEqual(sorted(s for s, _ in results)[0], 201, results)
        self.assertTrue(all(s < 500 for s, _ in results), results)
        self.assertEqual(self.debits(order).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertEqual(self.db(order).status, "SUBMITTED")
        self.assert_invariant()

    def test_two_sessions_proposing_same_order_open_one_pending_action(self):
        """Racing proposals never 500: one PENDING action, the other step is an ERROR."""
        order, _ = self.new_order(amount="1000.00")
        lock = threading.Lock()

        def factory():
            with lock:
                return StubPlanner([call("submit_remittance_order", order_id=self.oid(order))])

        path = "/api/v2/agent/sessions/"
        post = lambda c: c.post(path, {"goal": "提交订单", "locale": "zh"}, format="json",
                                HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        original = agent_runner.planner
        agent_runner.planner = factory
        try:
            results = self.race([post, post, post])
        finally:
            agent_runner.planner = original
        self.assertEqual([s for s, _ in results], [201, 201, 201], results)
        self.assertEqual(AgentPendingAction.objects.filter(owner=self.user, status="PENDING").count(), 1)
        steps = AgentStep.objects.filter(owner=self.user, tool="submit_remittance_order")
        self.assertEqual(sorted(s.status for s in steps), ["ERROR", "ERROR", "PROPOSED"])
        for step in steps.filter(status="ERROR"):
            self.assertRegex(str(step.result), "ALREADY_PROPOSED|CONCURRENT_UPDATE")
        self.assertEqual(self.debits(order).count(), 0)

    # ------------------------------------------------------------------ session idempotency race
    def test_same_session_key_concurrently_runs_planner_once(self):
        lock = threading.Lock()
        made = []

        def slow(context):
            time.sleep(0.3)
            return call("get_balances") if context.steps_remaining == 10 else final()

        def factory():
            with lock:
                stub = StubPlanner([slow, slow])
                made.append(stub)
                return stub

        path = "/api/v2/agent/sessions/"
        body = {"goal": "查余额", "locale": "zh"}
        post = lambda c: c.post(path, body, format="json", HTTP_IDEMPOTENCY_KEY="same-session")
        original = agent_runner.planner
        agent_runner.planner = factory
        try:
            results = self.race([post, post, post])
        finally:
            agent_runner.planner = original
        self.assertTrue(all(s in (200, 201) for s, _ in results), results)
        self.assertEqual(sorted(s for s, _ in results).count(201), 1, results)
        self.assertEqual(len({d["data"]["id"] for _, d in results}), 1)
        self.assertEqual(AgentSession.objects.filter(owner=self.user).count(), 1)
        self.assertEqual(len(made), 1, "planner must run once per idempotency key")
        self.assertEqual(AgentStep.objects.filter(owner=self.user).count(), 2)
        self.assertEqual(AgentPendingAction.objects.count(), 0)
