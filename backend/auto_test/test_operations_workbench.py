from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from auto_test.test_multicurrency import FX_SETTINGS
from auto_test.test_policy import PolicyHarness
from finance.policy_models import ApprovalRequest
from finance.workflow_models import Beneficiary


class WorkbenchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.staff = get_user_model().objects.create_user(username="operator", is_staff=True)
        self.student = get_user_model().objects.create_user(username="Alice")
        self.now = timezone.now()

    def read(self, **params):
        self.client.force_authenticate(self.staff)
        response = self.client.get("/api/v2/operations/workbench/", params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["data"]

    def approval(self, minutes, **values):
        return ApprovalRequest.objects.create(owner=self.student, requested_by=self.student,
            action="wallet.convert", target_id=uuid4(), amount="100", currency="THB",
            reason="Test review", expires_at=self.now + timedelta(minutes=minutes), **values)

    def test_permissions_and_empty_summary(self):
        self.assertEqual(self.client.get("/api/v2/operations/workbench/").status_code, 401)
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get("/api/v2/operations/workbench/").status_code, 403)
        data = self.read()
        self.assertEqual(data["summary"]["total"], 0)
        self.assertEqual(data["items"], [])
        self.assertEqual(data["pagination"], {"page": 1, "page_size": 20, "total": 0, "pages": 1})

    def test_full_counts_and_stable_pagination_beyond_one_hundred(self):
        Beneficiary.objects.bulk_create([Beneficiary(owner=self.student, name=f"Payee {i}") for i in range(125)])
        seen = []
        for page in range(1, 8):
            data = self.read(page=page)
            self.assertEqual(data["summary"]["total"], 125)
            self.assertEqual(data["summary"]["unverified"], 125)
            seen.extend(item["record"]["id"] for item in data["items"])
        self.assertEqual(len(seen), 125)
        self.assertEqual(len(set(seen)), 125)
        self.assertEqual(self.read(page=999)["pagination"]["page"], 7)

    def test_student_filter_precedes_pagination_and_only_student_affects_summary(self):
        Beneficiary.objects.bulk_create([Beneficiary(owner=self.staff, name="Other") for _ in range(110)])
        Beneficiary.objects.create(owner=self.student, name="Alice payee")
        self.approval(30)
        data = self.read(student="  ALIce  ", kind="payees")
        self.assertEqual(data["summary"]["total"], 2)
        self.assertEqual(data["pagination"]["total"], 1)
        self.assertEqual(data["items"][0]["record"]["name"], "Alice payee")
        self.assertEqual(self.read(student="missing")["summary"]["total"], 0)

    def test_expiry_boundary_priority_and_read_does_not_write(self):
        expired = self.approval(0)
        first = self.approval(60)
        self.approval(61)
        Beneficiary.objects.create(owner=self.student, name="Payee")
        with patch("finance.operations_workbench.timezone.now", return_value=self.now):
            data = self.read()
            filtered = self.read(attention="expiring")
        self.assertEqual(data["summary"]["expiring"], 1)
        self.assertEqual(data["summary"]["total"], 3)
        self.assertEqual(data["items"][0]["record"]["id"], str(first.pk))
        self.assertEqual(filtered["pagination"]["total"], 1)
        self.assertEqual(data["recent_decisions"][0]["status"], "EXPIRED")
        expired.refresh_from_db()
        self.assertEqual(expired.status, "PENDING")

    def test_recent_records_are_limited_after_student_filter_and_keep_used_status(self):
        for _ in range(23):
            self.approval(120, status="USED", decided_by=self.staff, decided_at=self.now)
        data = self.read(student="Alice")
        self.assertEqual(len(data["recent_decisions"]), 20)
        self.assertTrue(all(row["status"] == "USED" for row in data["recent_decisions"]))
        self.assertEqual(data["summary"]["total"], 0)

    def test_invalid_filters_return_validation_error(self):
        self.client.force_authenticate(self.staff)
        for params in ({"kind": "garbage"}, {"attention": "garbage"}, {"page": 0}, {"page_size": 101}):
            self.assertEqual(self.client.get("/api/v2/operations/workbench/", params).status_code, 400)


@override_settings(**FX_SETTINGS)
class WorkbenchBusinessTests(PolicyHarness, APITestCase):
    def workbench(self, **params):
        self.client.force_authenticate(self.operator)
        response = self.client.get("/api/v2/operations/workbench/", params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["data"]

    def test_unknown_payment_is_counted_and_prioritized(self):
        payment = self.pending_payment("rent")
        self.post(f"payments/{payment['id']}/adapter-event", {"outcome": "unknown"}, operator=True)
        data = self.workbench()
        self.assertEqual(data["summary"]["unknown"], 1)
        self.assertEqual(data["items"][0]["kind"], "payment")
        self.assertEqual(self.workbench(attention="unknown")["pagination"]["total"], 1)

    def test_blocked_approval_is_counted_and_serialized(self):
        tuition = self.payment("tuition")
        self.ask("payment.submit", tuition["id"], "65000.00")
        data = self.workbench()
        self.assertEqual(data["summary"]["by_kind"]["approvals"], 1)
        approval = next(row["record"] for row in data["items"] if row["kind"] == "approval")
        self.assertFalse(approval["can_decide"])
        self.assertEqual(approval["blocked_reason"], "VERIFIED_PAYEE")
