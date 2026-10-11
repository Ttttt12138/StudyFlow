from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, override_settings

from finance.readiness.adapter import DjangoReadinessBackend
from finance.readiness.models import CheckLease, Semester
from finance.readiness.templates import get_template
from finance.services import save_state


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
@override_settings(STUDYFLOW_READINESS_ENABLED=True)
class ReadinessConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="lease-student")
        self.snapshot = {
            "as_of": "2026-08-01",
            "currency": "THB",
            "opening_balance": "140000.00",
            "reserve": "15000.00",
            "events": [],
        }
        save_state(self.user, 0, self.snapshot)
        template = get_template()
        Semester.objects.create(
            owner=self.user,
            template_key=template["key"],
            draft={
                k: template[k]
                for k in ("profile", "costs", "reserve", "required_categories")
            },
        )

    def test_two_workers_cannot_own_the_same_check(self):
        barrier = Barrier(2)
        worker_connections = []

        def claim():
            close_old_connections()
            worker_connections.append(connections["default"])
            try:
                backend = DjangoReadinessBackend(self.user)
                barrier.wait(timeout=5)
                return backend.claim_readiness_check("shared-check")
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: claim(), range(2)))
        for worker_connection in worker_connections:
            self.assertIsNone(worker_connection.connection)
        self.assertEqual(sorted(results), [False, True])
        self.assertEqual(CheckLease.objects.filter(key="shared-check").count(), 1)

    def test_model_result_cannot_commit_after_state_changes(self):
        from studyflow_ai.readiness.models import ReadinessResult

        backend = DjangoReadinessBackend(self.user)
        self.assertTrue(backend.claim_readiness_check("stale"))
        save_state(self.user, 1, self.snapshot)
        result = ReadinessResult(state_version=1, budget_version=1)
        self.assertFalse(backend.save_readiness_check("stale", result))
        self.assertIsNone(CheckLease.objects.get(key="stale").result)
