from copy import deepcopy
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token
from .calculations import forecast
from .models import FinancialState, SourceDocument, AuditEvent

BASE = {
    "currency": "THB", "as_of": "2026-10-02",
    "opening_balance": "80000.00", "reserve": "15000.00",
    "events": [
        {"id": "rent", "label": "Rent", "kind": "expense", "amount": "9000.00",
         "date": "2026-10-05", "certainty": "confirmed"},
        {"id": "tuition", "label": "Tuition", "kind": "expense", "amount": "65000.00",
         "date": "2026-10-15", "certainty": "confirmed"},
    ],
}

class CalculationTests(SimpleTestCase):
    def test_basic_fixture(self):
        result = forecast(BASE, "2026-10-31")
        self.assertEqual(result["ending_balance"], "6000.00")
        self.assertEqual(result["maximum_reserve_gap"], "9000.00")
        self.assertEqual(result["first_gap_date"], "2026-10-15")

    def test_living_expenses(self):
        state = deepcopy(BASE)
        state["events"].append({"id": "living", "label": "Living", "kind": "expense",
            "amount": "9400.00", "date": "2026-10-14", "certainty": "confirmed"})
        result = forecast(state, "2026-10-31")
        self.assertEqual(result["maximum_cash_shortfall"], "3400.00")
        self.assertEqual(result["maximum_reserve_gap"], "18400.00")

    def test_late_funding_does_not_erase_gap(self):
        state = deepcopy(BASE)
        state["events"].append({"id": "support", "label": "Support", "kind": "income",
            "amount": "9000.00", "date": "2026-10-16", "certainty": "confirmed"})
        result = forecast(state, "2026-10-31")
        self.assertEqual(result["ending_balance"], "15000.00")
        self.assertEqual(result["maximum_reserve_gap"], "9000.00")

    def test_same_day_expenses_before_income(self):
        state = deepcopy(BASE)
        state["events"].append({"id": "support", "label": "Support", "kind": "income",
            "amount": "9000.00", "date": "2026-10-15", "certainty": "confirmed"})
        self.assertEqual(forecast(state, "2026-10-31")["maximum_reserve_gap"], "9000.00")

    def test_missing_not_zero(self):
        state = deepcopy(BASE)
        state["events"].append({"id": "visa", "label": "Visa", "kind": "expense",
            "amount": None, "date": None, "certainty": "missing"})
        result = forecast(state, "2026-10-31")
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["missing_event_ids"], ["visa"])

    def test_estimates_are_explicit(self):
        state = deepcopy(BASE)
        state["events"][0]["certainty"] = "estimated"
        result = forecast(state, "2026-10-31")
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["excluded_estimate_ids"], ["rent"])
        self.assertEqual(forecast(state, "2026-10-31", True)["maximum_reserve_gap"], "9000.00")

    def test_precision(self):
        state = deepcopy(BASE)
        state["opening_balance"] = "0.30"
        state["reserve"] = "0.00"
        state["events"] = [
            {**BASE["events"][0], "amount": "0.10"},
            {**BASE["events"][1], "amount": "0.20"},
        ]
        self.assertEqual(forecast(state, "2026-10-31")["ending_balance"], "0.00")

    def test_invalid_horizon(self):
        with self.assertRaises(ValueError):
            forecast(BASE, "2026-10-01")

class IntegrationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="student", password="test-password")
        self.other = get_user_model().objects.create_user(username="other", password="test-password")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION="Token " + token.key)

    def save(self, snapshot=None, version=0):
        return self.client.post("/api/v2/state/", {
            "expected_version": version, "snapshot": snapshot or deepcopy(BASE),
        }, format="json")

    def test_auth_required(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/v2/state/").status_code, 401)

    def test_state_forecast_and_audit(self):
        self.assertEqual(self.save().status_code, 201)
        result = self.client.post("/api/v2/forecasts/", {
            "state_version": 1, "end_date": "2026-10-31",
        }, format="json")
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.data["result"]["maximum_reserve_gap"], "9000.00")
        self.assertEqual(AuditEvent.objects.filter(owner=self.user).count(), 2)
        self.assertEqual(self.client.get("/api/v2/state/").data["snapshot"]["opening_balance"], "80000.00")

    def test_stale_state_preserves_history(self):
        self.assertEqual(self.save().status_code, 201)
        self.assertEqual(self.save().status_code, 409)
        self.assertEqual(self.save(version=1).status_code, 201)
        self.assertEqual(FinancialState.objects.count(), 2)
        result = self.client.post("/api/v2/forecasts/", {
            "state_version": 1, "end_date": "2026-10-31",
        }, format="json")
        self.assertEqual(result.status_code, 409)

    def test_ownership(self):
        FinancialState.objects.create(owner=self.other, version=1, snapshot=BASE)
        self.assertEqual(self.client.get("/api/v2/state/").status_code, 404)
        source = SourceDocument.objects.create(owner=self.other, title="Private", kind="upload")
        state = deepcopy(BASE)
        state["events"][0]["source_id"] = str(source.id)
        self.assertEqual(self.save(state).status_code, 400)
        self.assertEqual(self.client.get("/api/v2/sources/").data["count"], 0)

    def test_invalid_inputs(self):
        cases = []
        duplicate = deepcopy(BASE)
        duplicate["events"][1]["id"] = "rent"
        cases.append(duplicate)
        past = deepcopy(BASE)
        past["events"][0]["date"] = "2026-10-01"
        cases.append(past)
        missing = deepcopy(BASE)
        missing["events"][0]["amount"] = None
        cases.append(missing)
        negative = deepcopy(BASE)
        negative["opening_balance"] = "-1.00"
        cases.append(negative)
        currency = deepcopy(BASE)
        currency["currency"] = "USD"
        cases.append(currency)
        for state in cases:
            with self.subTest(state=state):
                self.assertEqual(self.save(state).status_code, 400)
        self.assertEqual(FinancialState.objects.count(), 0)

    def test_source_and_missing_state(self):
        response = self.client.post("/api/v2/sources/", {
            "kind": "official_url", "title": "Fees",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/v2/sources/", {
            "kind": "official_url", "title": "Fees", "url": "https://example.edu/fees",
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.client.post("/api/v2/forecasts/", {
            "state_version": 1, "end_date": "2026-10-31",
        }, format="json").status_code, 404)

    def test_decimal_strings_survive_database(self):
        state = deepcopy(BASE)
        state["opening_balance"] = "0.30"
        state["reserve"] = "0.00"
        state["events"][0]["amount"] = "0.10"
        state["events"][1]["amount"] = "0.20"
        self.assertEqual(self.save(state).status_code, 201)
        stored = FinancialState.objects.get(owner=self.user)
        self.assertEqual(stored.snapshot["opening_balance"], "0.30")
        result = self.client.post("/api/v2/forecasts/", {
            "state_version": 1, "end_date": "2026-10-31",
        }, format="json")
        self.assertEqual(result.data["result"]["ending_balance"], "0.00")
