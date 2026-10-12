"""A verified cost (e.g. a confirmed tuition invoice) must survive unrelated draft revisions unchanged."""
from copy import deepcopy

from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from auto_test import test_readiness_api as readiness
from finance.readiness.models import Semester
from finance.readiness.services import normalize_draft


@override_settings(STUDYFLOW_READINESS_ENABLED=True, STUDYFLOW_AI_MODE="mock")
class VerifiedCostRevisionTests(APITestCase):
    # Reuse the readiness setup without importing its test class (which would run its tests here too).
    setUp = readiness.ReadinessApiTests.setUp
    post = readiness.ReadinessApiTests.post

    def stored_with_verified_tuition(self):
        semester = Semester.objects.get(pk=self.semester_id)
        tuition = next(c for c in semester.draft["costs"] if c["cost_id"] == "tuition")
        # As stored after an import confirmation: timestamps serialized with "+00:00", not "Z".
        tuition.update(confidence_type="VERIFIED", issuer="Synthetic University", amount="30000.00", invoice_id="DEMO-2026-1",
                       verification_reference="user:1:material:dee5fc67-908d-4081-a830-1bcd90c47e3f",
                       source_refs=["dee5fc67-908d-4081-a830-1bcd90c47e3f"],
                       verified_at="2026-10-01T08:00:00.123456+00:00", observed_at="2026-10-01T07:59:59.000001+00:00")
        return semester.draft

    def test_unrelated_revision_keeps_a_stored_verified_cost(self):
        stored = self.stored_with_verified_tuition()
        revised = deepcopy(stored)
        food = next(c for c in revised["costs"] if c["cost_id"] != "tuition")
        food["amount"] = "1234.00"
        result = normalize_draft(self.user, revised, stored)
        self.assertEqual(next(c for c in result["costs"] if c["cost_id"] == "tuition")["confidence_type"], "VERIFIED")

    def test_changing_a_verified_cost_still_needs_an_import(self):
        stored = self.stored_with_verified_tuition()
        revised = deepcopy(stored)
        next(c for c in revised["costs"] if c["cost_id"] == "tuition")["amount"] = "1.00"
        with self.assertRaises((ValidationError, DjangoValidationError)) as caught:
            normalize_draft(self.user, revised, stored)
        self.assertIn("USE_IMPORT_CONFIRMATION_TO_VERIFY", str(caught.exception))
