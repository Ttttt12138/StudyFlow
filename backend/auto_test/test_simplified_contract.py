"""Shared contract for the user-entered loan flow and retired student features."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from finance.planning import services
from finance.planning.models import StudyPlan, StudyTask
from finance.workflow_models import SimulatedApplication


class SimplifiedContractTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user("simple-contract", password="test-contract-17")
        self.client.force_authenticate(self.user)
        self.plan = services.save_plan(self.user, {"school_key": "psu-phuket"})["plan"]

    def post(self, route, body, key=None):
        return self.client.post("/api/v2/planning/" + route, body, format="json",
                                HTTP_IDEMPOTENCY_KEY=key or str(uuid4()))

    def save(self, principal="20000.00", fees="0.00", **extra):
        first_due = services.today_for(self.user) + timedelta(days=60)
        return self.post("assessment/", {"expected_version": 0, "plan_version": self.plan["version"],
            "inputs": {"borrower": "student_with_parent", "loan": {"principal": principal,
                "fees": fees, "first_due_date": first_due.isoformat(), "months": 48}, **extra}})

    def test_amount_without_funds_returns_new_contract(self):
        response = self.save()
        self.assertEqual(response.status_code, 201, response.data)
        result = response.data["data"]
        self.assertEqual(set(result["inputs"]), {"loan", "borrower"})
        self.assertEqual(result["quotes"][0]["inputs"]["principal"], "20000.00")
        self.assertIn("products", result)
        self.assertIn("limit", result)
        self.assertTrue({"prequal", "forecast", "conditional_forecast", "suggested_principal"}.isdisjoint(result))

    def test_save_plan_returns_the_loan_amount_said_in_chat(self):
        """The chat reply repeats the amount stored for the loan panel, in THB."""
        self.assertIsNone(services.save_plan(self.user, {"school_key": "psu-phuket"})["loan_principal"])
        saved = services.save_plan(self.user, {"school_key": "psu-phuket", "principal": Decimal("200000"),
                                               "principal_currency": "THB"})
        self.assertEqual(saved["loan_principal"], "200000.00")
        panel = self.client.get("/api/v2/planning/assessment/").data["data"]
        self.assertEqual(panel["inputs"]["loan"]["principal"], "200000.00")
        expected = services.convert(Decimal("50000"), "CNY", "THB")["amount"]
        converted = services.save_plan(self.user, {"school_key": "psu-phuket", "principal": Decimal("50000"),
                                                   "principal_currency": "CNY"})
        self.assertEqual(converted["loan_principal"], expected)

    def test_fees_do_not_raise_the_full_course_limit(self):
        initial = self.client.get("/api/v2/planning/assessment/").data["data"]
        cap = Decimal(initial["limit"]["max_principal"])
        rejected = self.save(str(cap + 1), "100.00")
        self.assertEqual(rejected.status_code, 400, rejected.data)
        self.assertEqual(rejected.data["code"], "AMOUNT_ABOVE_LIMIT")
        accepted = self.save(str(cap), "100.00")
        self.assertEqual(accepted.status_code, 201, accepted.data)
        self.assertEqual(Decimal(accepted.data["data"]["limit"]["max_principal"]), cap)

    def test_confirm_requires_quote_and_attaches_readonly_admission(self):
        result = self.save().data["data"]
        body = {"expected_version": result["version"], "plan_version": self.plan["version"]}
        self.assertEqual(self.post("plan/confirm/", {**body, "quote_id": None}).status_code, 400)
        body["quote_id"] = result["quotes"][0]["id"]
        key = str(uuid4())
        response = self.post("plan/confirm/", body, key)
        self.assertEqual(response.status_code, 201, response.data)
        replay = self.post("plan/confirm/", body, key)
        self.assertIn(replay.status_code, (200, 201))
        self.assertEqual(SimulatedApplication.objects.filter(owner=self.user).count(), 1)
        self.assertEqual(StudyPlan.objects.get(owner=self.user).status, "CONFIRMED")
        admission = next(d for d in response.data["data"]["loan_stage"]["documents"] if d["auto"])
        self.assertTrue(admission["done"])
        refused = self.post("loan/documents/", {"task_id": admission["id"], "done": False,
                                               "expected_version": admission["version"]})
        self.assertEqual(refused.status_code, 400, refused.data)
        self.assertEqual(refused.data["code"], "LOAN_DOCUMENT_AUTOMATIC")
        self.assertTrue(StudyTask.objects.get(pk=admission["id"]).done)

    def test_retired_fields_and_routes_are_not_exposed(self):
        response = self.save(available_funds="9999999", supports=[{"amount": "9999999"}])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("available_funds", response.data["data"]["inputs"])
        self.assertNotIn("family", self.client.get("/api/v2/planning/profile/").data["data"])
        life = self.client.get("/api/v2/planning/life/").data["data"]
        self.assertTrue({"budget", "credit", "funding"}.isdisjoint(life))
        for route in ("family-links/", "credit/", "expenses/", "in-school/", "life/budget/", "life/undo-expense/"):
            with self.subTest(route=route):
                self.assertEqual(self.client.get("/api/v2/planning/" + route).status_code, 404)

    def test_preview_uses_same_cap_without_creating_a_quote(self):
        before = SimulatedApplication.objects.count()
        response = self.post("loan-preview/", {"principal": "20000.00", "months": 48})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"]["principal"], "20000.00")
        self.assertGreater(Decimal(response.data["data"]["total_repayment"]), Decimal("20000"))
        self.assertEqual(SimulatedApplication.objects.count(), before)
