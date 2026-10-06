from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from finance.consumption.models import ObservedTransaction
from finance.sponsorship import SponsorRequest


@skipUnless(connection.vendor == "postgresql", "PostgreSQL locking is required")
@override_settings(
    STUDYFLOW_READINESS_ENABLED=True,
    STUDYFLOW_CONSUMPTION_ENABLED=True,
    STUDYFLOW_AI_MODE="mock",
)
class ConsumptionConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="concurrent-consumption"
        )
        self.operator = get_user_model().objects.create_user(
            username="concurrent-sponsor-operator", is_staff=True
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        semester = self.post(
            "readiness/semesters",
            {"reserve": "1000", "opening_balance": "10000", "as_of": "2026-10-01"},
        )
        self.post("demo/initialize", {"state_version": semester["state_version"]})

    def post(self, route, data):
        response = self.client.post(
            "/api/v2/" + route + "/",
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid4().hex,
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["data"]

    def race(self, route, bodies, headers=None, authenticated=True):
        barrier = Barrier(2)

        def call(index):
            try:
                client = APIClient()
                if authenticated:
                    client.force_authenticate(
                        get_user_model().objects.get(pk=self.user.pk)
                    )
                barrier.wait(timeout=10)
                response = client.post(
                    "/api/v2/" + route + "/",
                    bodies[index],
                    format="json",
                    HTTP_IDEMPOTENCY_KEY=uuid4().hex,
                    **(headers or {}),
                )
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            return sorted(executor.map(call, range(2)))

    def test_concurrent_import_confirmation_does_not_duplicate_transactions(self):
        content = b"transaction_id,account_id,date,amount,currency,counterparty,description\na,main,2026-09-01,-100,THB,Cafe,Food\n"
        response = self.client.post(
            "/api/v2/readiness/transaction-imports/",
            {"file": SimpleUploadedFile("history.csv", content)},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=uuid4().hex,
        )
        self.assertEqual(response.status_code, 202)
        body = {
            "selected_rows": ["row:2"],
            "coverage": [
                {
                    "account_id": "main",
                    "start": "2026-09-01",
                    "end": "2026-09-30",
                    "complete": True,
                }
            ],
        }
        route = (
            "readiness/transaction-imports/" + response.data["data"]["id"] + "/confirm"
        )
        self.assertEqual(self.race(route, [body, body]), [201, 400])
        self.assertEqual(ObservedTransaction.objects.count(), 1)

    def test_concurrent_sponsor_decisions_cannot_both_win(self):
        item = self.post(
            "sponsor-requests",
            {
                "economic_key": "support",
                "amount": "5000",
                "currency": "THB",
                "available_on": "2026-10-01",
                "purpose": "Tuition",
            },
        )
        self.client.force_authenticate(self.operator)
        token = self.post(
            "sponsor-requests/" + item["id"] + "/issue-link", {"terms_version": 1}
        )["token"]
        bodies = [
            {"terms_version": 1, "decision": decision}
            for decision in ["confirm", "reject"]
        ]
        statuses = self.race(
            "sponsor-confirmation",
            bodies,
            {"HTTP_X_SPONSOR_TOKEN": token},
            authenticated=False,
        )
        self.assertEqual(statuses, [200, 400])
        item = SponsorRequest.objects.get(pk=item["id"])
        self.assertEqual(
            item.source.certainty == "confirmed", item.status == "CONFIRMED"
        )
