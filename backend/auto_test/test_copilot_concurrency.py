from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from auto_test import test_copilot as fixtures
from finance.copilot.models import WhatIfRun
from finance.workflow_models import DemoLedgerEntry, IdempotencyRecord


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL locking")
@override_settings(
    STUDYFLOW_READINESS_ENABLED=True,
    STUDYFLOW_CONSUMPTION_ENABLED=False,
    STUDYFLOW_AI_MODE="mock",
)
class CopilotConcurrencyTests(TransactionTestCase):
    post = fixtures.CopilotTests.post
    context = fixtures.CopilotTests.context
    simulate = fixtures.CopilotTests.simulate

    def setUp(self):
        self.client = APIClient()
        fixtures.CopilotTests.setUp(self)

    def test_concurrent_apply_has_one_effect(self):
        run = self.simulate()
        route = "readiness/what-if/" + run["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        barrier = Barrier(2)

        def apply():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(self.user)
                barrier.wait(timeout=10)
                response = client.post(
                    "/api/v2/" + route + "/apply/",
                    {"confirmation": preview["confirmation"]},
                    format="json",
                    HTTP_IDEMPOTENCY_KEY="concurrent-apply",
                )
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: apply(), range(2)))
        self.assertEqual(sorted(status for status, _ in results), [200, 201])
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(WhatIfRun.objects.get(pk=run["id"]).applied_index, 0)
        self.assertEqual(
            IdempotencyRecord.objects.filter(key="concurrent-apply").count(), 1
        )
        self.assertFalse(DemoLedgerEntry.objects.filter(owner=self.user).exists())
