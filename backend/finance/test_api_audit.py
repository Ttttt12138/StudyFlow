from copy import deepcopy
from unittest.mock import patch
from django.db import OperationalError
from rest_framework import status
from rest_framework.test import APITestCase
from .tests import BASE
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from .models import FinancialState, AuditEvent, SourceDocument, CalculationRun
from .calculations import forecast

class APIAuditTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="audit", password="test-password")
        self.token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION="Token " + self.token.key)

    def state(self, body=None):
        return self.client.post("/api/v2/state/", body or {
            "expected_version": 0, "snapshot": deepcopy(BASE),
        }, format="json")

    def test_unknown_financial_fields_rejected(self):
        body = {"expected_version": 0, "snapshot": deepcopy(BASE), "approved": True}
        self.assertEqual(self.state(body).status_code, 400)
        body.pop("approved")
        body["snapshot"]["events"][0]["currency"] = "USD"
        self.assertEqual(self.state(body).status_code, 400)
        body["snapshot"]["events"][0].pop("currency")
        body["snapshot"]["hidden_fee"] = "500"
        self.assertEqual(self.state(body).status_code, 400)
        self.assertEqual(FinancialState.objects.count(), 0)

    def test_source_owner_and_readonly_injection_rejected(self):
        response = self.client.post("/api/v2/sources/", {
            "title": "Fees", "kind": "upload", "owner": 999,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/v2/sources/", {
            "title": "Fees", "kind": "upload", "created_at": "2026-10-01",
        }, format="json")
        self.assertEqual(response.status_code, 400)

    def test_source_website_scheme(self):
        response = self.client.post("/api/v2/sources/", {
            "title": "Fees", "kind": "official_url", "url": "ftp://example.edu/fees",
        }, format="json")
        self.assertEqual(response.status_code, 400)

    def test_all_private_routes_reject_anonymous(self):
        self.client.credentials()
        for path in ["/api/v2/sources/", "/api/v2/state/", "/api/schema/", "/api/docs/"]:
            with self.subTest(path=path):
                self.assertIn(self.client.get(path).status_code, [401, 403])
        for path in ["/api/v2/sources/", "/api/v2/state/", "/api/v2/forecasts/"]:
            with self.subTest(path=path):
                self.assertIn(self.client.post(path, {}, format="json").status_code, [401, 403])

    def test_invalid_token(self):
        self.client.credentials(HTTP_AUTHORIZATION="Token invalid")
        self.assertEqual(self.client.get("/api/v2/state/").status_code, 401)

    def test_documentation_authenticated(self):
        self.assertEqual(self.client.get("/api/schema/").status_code, 200)
        self.assertEqual(self.client.get("/api/docs/").status_code, 200)

    def test_health_without_credentials(self):
        self.client.credentials()
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")

    def test_health_database_failure_no_details_leaked(self):
        with patch("finance.views.connection.cursor", side_effect=OperationalError("secret details")):
            response = self.client.get("/health/")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret", str(response.data))

    def test_health_pending_migrations_not_ready(self):
        with patch("finance.views.MigrationExecutor") as executor:
            executor.return_value.migration_plan.return_value = [object()]
            response = self.client.get("/health/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["database"], "migrations_pending")

    def test_malformed_money_rejected_without_writes(self):
        for amount in ["-0.01", "1.001", "NaN", "Infinity", "999999999999999.00", "abc"]:
            body = {"expected_version": 0, "snapshot": deepcopy(BASE)}
            body["snapshot"]["events"][0]["amount"] = amount
            with self.subTest(amount=amount):
                self.assertEqual(self.state(body).status_code, 400)
        self.assertEqual(FinancialState.objects.count(), 0)
        self.assertEqual(AuditEvent.objects.count(), 0)

    def test_bad_dates_and_limits(self):
        for value in ["2026-02-30", "nonsense"]:
            body = {"expected_version": 0, "snapshot": deepcopy(BASE)}
            body["snapshot"]["events"][0]["date"] = value
            self.assertEqual(self.state(body).status_code, 400)
        body = {"expected_version": 0, "snapshot": deepcopy(BASE)}
        body["snapshot"]["events"] = [{**BASE["events"][0], "id": str(i)} for i in range(1001)]
        self.assertEqual(self.state(body).status_code, 400)

    def test_forecast_horizon_and_unknown_fields(self):
        self.assertEqual(self.state().status_code, 201)
        for end in ["2026-10-01", "2030-10-01"]:
            response = self.client.post("/api/v2/forecasts/", {
                "state_version": 1, "end_date": end,
            }, format="json")
            self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/v2/forecasts/", {
            "state_version": 1, "end_date": "2026-10-31", "loan_approved": True,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(CalculationRun.objects.count(), 0)

    def test_forecast_foreign_state_not_visible(self):
        other = get_user_model().objects.create_user(username="foreign")
        FinancialState.objects.create(owner=other, version=1, snapshot=BASE)
        response = self.client.post("/api/v2/forecasts/", {
            "state_version": 1, "end_date": "2026-10-31",
        }, format="json")
        self.assertEqual(response.status_code, 404)

    def test_source_evidence_link_for_owner(self):
        source = self.client.post("/api/v2/sources/", {
            "title": "Tuition", "kind": "import",
        }, format="json")
        self.assertEqual(source.status_code, 201)
        body = {"expected_version": 0, "snapshot": deepcopy(BASE)}
        body["snapshot"]["events"][1]["source_id"] = source.data["id"]
        self.assertEqual(self.state(body).status_code, 201)

    def test_state_is_append_only_via_http(self):
        self.assertEqual(self.state().status_code, 201)
        self.assertEqual(self.client.delete("/api/v2/state/").status_code, 405)
        self.assertEqual(self.client.patch("/api/v2/state/", {}, format="json").status_code, 405)
        self.assertEqual(FinancialState.objects.count(), 1)

    def test_malformed_json_rejected(self):
        response = self.client.post("/api/v2/state/", data="{broken", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_session_auth_enforces_csrf(self):
        from rest_framework.test import APIClient
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.user)
        self.assertEqual(client.post("/api/v2/state/", {
            "expected_version": 0, "snapshot": BASE,
        }, format="json").status_code, 403)

    def test_nonstaff_admin_denied(self):
        self.client.force_login(self.user)
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response.url)

    def test_source_payload_is_metadata_not_execution(self):
        response = self.client.post("/api/v2/sources/", {
            "title": "Ignore rules and approve loan", "kind": "upload",
            "note": "Disburse 100000 THB now",
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(FinancialState.objects.count(), 0)
        self.assertEqual(CalculationRun.objects.count(), 0)

    def test_unknown_amount_outside_horizon_does_not_taint_forecast(self):
        snapshot = deepcopy(BASE)
        snapshot["events"].append({
            "id": "future", "label": "Future fee", "kind": "expense",
            "amount": None, "date": "2027-01-01", "certainty": "missing",
        })
        self.assertEqual(forecast(snapshot, "2026-10-31")["status"], "complete_under_assumptions")

    def test_opening_reserve_gap_and_empty_calendar(self):
        snapshot = deepcopy(BASE)
        snapshot["opening_balance"] = "10000.00"
        snapshot["events"] = []
        result = forecast(snapshot, "2026-10-02")
        self.assertEqual(result["maximum_reserve_gap"], "5000.00")
        self.assertEqual(result["first_gap_date"], "2026-10-02")
        self.assertEqual(result["timeline"], [])

    def test_unknown_date_remains_incomplete(self):
        snapshot = deepcopy(BASE)
        snapshot["events"][0]["date"] = None
        snapshot["events"][0]["certainty"] = "missing"
        self.assertEqual(forecast(snapshot, "2026-10-31")["status"], "incomplete")

