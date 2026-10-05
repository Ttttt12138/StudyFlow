from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from finance.readiness.funding import apply_actions
from finance.readiness.jobs import claim_job, finish_job, run_one
from finance.readiness.models import (
    ImportMaterial,
    NotificationOutbox,
    ReadinessJob,
    Semester,
)
from finance.workflow_common import current


@override_settings(STUDYFLOW_READINESS_ENABLED=True, STUDYFLOW_AI_MODE="mock")
class ReadinessApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="readiness-student")
        self.other = get_user_model().objects.create_user(username="readiness-other")
        self.client.force_authenticate(self.user)
        created = self.post(
            "readiness/semesters",
            {
                "room": "shared",
                "reserve": "15000.00",
                "opening_balance": "140000.00",
                "as_of": "2026-08-01",
            },
        )
        self.semester_id = created["id"]
        self.post("demo/initialize", {"state_version": created["state_version"]})

    def post(self, path, data, code=201, key=None):
        response = self.client.post(
            "/api/v2/" + path + "/",
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key or str(uuid4()),
        )
        self.assertEqual(response.status_code, code, response.data)
        return response.data.get("data", response.data)

    def context(self):
        semester = Semester.objects.get(pk=self.semester_id)
        return {
            "semester_id": self.semester_id,
            "state_version": current(self.user).version,
            "budget_version": semester.version,
        }

    def complete_draft(self, amount="175000.00"):
        draft = deepcopy(Semester.objects.get(pk=self.semester_id).draft)
        for cost in draft["costs"]:
            cost.update(
                paid=False,
                conflict=False,
                synthetic=True,
                source_refs=[],
                valid_until=None,
            )
            if cost["cost_id"] == "tuition":
                cost.update(amount=amount, due_date="2026-08-10")
            else:
                cost.update(
                    applicability="NOT_APPLICABLE",
                    applicability_reason="Synthetic test scope",
                )
        return draft

    def revise(self, draft=None):
        return self.post(
            "readiness/semesters/revise",
            {**self.context(), "draft": draft or self.complete_draft()},
        )

    def test_template_is_incomplete_and_cannot_forge_verification(self):
        result = self.post("readiness/budgets", self.context())["result"]
        self.assertFalse(result["complete"])
        self.assertIn("CONFLICT:deposit", result["issues"])
        draft = self.complete_draft()
        draft["costs"][0].update(
            confidence_type="VERIFIED", verification_reference="fake"
        )
        self.post("readiness/semesters/revise", {**self.context(), "draft": draft}, 400)

    def test_budget_forecast_versions_and_idempotency(self):
        self.revise()
        context = self.context()
        result = self.post("readiness/budgets", context, key="same")
        self.assertEqual(result["result"]["gap"], "50000.00")
        self.assertEqual(
            result, self.post("readiness/budgets", context, code=200, key="same")
        )
        forecast = self.post("readiness/forecasts", {**context, "horizon": 30})[
            "result"
        ]
        self.assertEqual(forecast["maximum_reserve_gap"], "50000.00")
        self.revise()
        self.post("readiness/budgets", context, 409)

    def test_risk_is_persistent_and_unchanged_does_not_notify(self):
        self.revise()
        self.post("readiness/checks", self.context())
        for _ in range(12):
            if not run_one():
                break
        self.assertGreater(
            NotificationOutbox.objects.filter(owner=self.user).count(), 0
        )
        before = NotificationOutbox.objects.count()
        self.post("readiness/checks", self.context())
        run_one()
        self.assertEqual(NotificationOutbox.objects.count(), before)
        self.assertTrue(
            ReadinessJob.objects.filter(kind="check", status="DONE").exists()
        )

    def test_foreign_user_cannot_read_semester(self):
        self.client.force_authenticate(self.other)
        response = self.client.get(
            "/api/v2/readiness/semesters/" + self.semester_id + "/"
        )
        self.assertEqual(response.status_code, 404)

    def test_reclaimed_job_cannot_be_finished_by_old_worker(self):
        old = claim_job()
        ReadinessJob.objects.filter(pk=old.pk).update(
            lease_until=timezone.now() - timedelta(seconds=1)
        )
        replacement = claim_job()
        self.assertEqual(old.pk, replacement.pk)
        self.assertEqual(finish_job(old, {"wrong": True}), 0)
        self.assertEqual(finish_job(replacement, {"ok": True}), 1)

    def test_upload_confirm_and_duplicate_content(self):
        context = self.context()
        text = b"School: Prince of Songkla University\nCampus: Phuket\nTuition: THB 175000 per semester, unpaid, year 2026, due 2026-08-10\n"

        def upload():
            response = self.client.post(
                "/api/v2/readiness/imports/",
                {
                    **context,
                    "kind": "text",
                    "file": SimpleUploadedFile(
                        "offer.txt", text, content_type="text/plain"
                    ),
                },
                format="multipart",
                HTTP_IDEMPOTENCY_KEY=str(uuid4()),
            )
            self.assertEqual(response.status_code, 202, response.data)
            return response.data["data"]

        material = upload()
        self.assertEqual(upload()["id"], material["id"])
        for _ in range(10):
            if not run_one():
                break
        stored = ImportMaterial.objects.get(pk=material["id"])
        self.assertEqual(stored.status, "NEEDS_REVIEW")
        result = self.post(
            "readiness/imports/" + material["id"] + "/confirm",
            {
                **self.context(),
                "draft": self.complete_draft(),
                "issuer": "PSU",
                "selected_cost_ids": ["tuition"],
                "conflict_resolutions": {
                    "tuition": "Synthetic invoice explicitly confirmed"
                },
            },
        )
        self.assertEqual(result["status"], "COMMITTED")
        self.assertEqual(current(self.user).snapshot["opening_balance"], "140000.00")

    def test_funding_and_reduction_leave_only_fifteen_thousand(self):
        draft = self.complete_draft("165000.00")
        food = next(c for c in draft["costs"] if c["cost_id"] == "food")
        food.update(
            applicability="APPLICABLE",
            applicability_reason=None,
            amount="10000.00",
            period="once",
            due_date="2026-08-20",
        )
        self.revise(draft)
        allocations = []
        for kind, amount in [("family", "20000.00"), ("scholarship", "10000.00")]:
            source = self.post(
                "funding-sources",
                {
                    "economic_key": kind,
                    "kind": kind,
                    "currency": "THB",
                    "amount": amount,
                    "available_on": "2026-08-05",
                    "certainty": "confirmed",
                    "already_in_opening": False,
                },
            )
            allocations.append({"source_id": source["id"], "amount": amount})
        plan = self.post(
            "readiness/funding-plans",
            {
                **self.context(),
                "allocations": allocations,
                "actions": [
                    {
                        "kind": "reduce_spending",
                        "cost_id": "food",
                        "amount": "5000.00",
                        "evidence": "Student selected cheaper meals",
                    }
                ],
            },
        )
        self.assertEqual(plan["result"]["remaining_gap"], "15000.00")

    def test_installment_preserves_total_not_income(self):
        draft = self.complete_draft("65000.00")
        revised = apply_actions(
            draft,
            [
                {
                    "kind": "installment",
                    "cost_id": "tuition",
                    "evidence": "School schedule",
                    "payments": [
                        {"date": "2026-08-10", "amount": "30000.00"},
                        {"date": "2026-10-10", "amount": "35000.00"},
                    ],
                }
            ],
        )
        tuition = [c for c in revised["costs"] if c["category"] == "tuition"]
        self.assertEqual(
            sum(Decimal(c["amount"]) for c in tuition), Decimal("65000.00")
        )

    def test_same_day_receipt_reduces_gap_without_double_allocation(self):
        self.revise()
        source = self.post(
            "funding-sources",
            {
                "economic_key": "receipt",
                "kind": "family",
                "currency": "THB",
                "amount": "20000.00",
                "available_on": "2026-08-01",
                "certainty": "confirmed",
            },
        )
        self.user.is_staff = True
        self.user.save(update_fields=["is_staff"])
        self.post("funding-sources/" + source["id"] + "/receive", {})
        budget = self.post("readiness/budgets", self.context())["result"]
        self.assertEqual(budget["gap"], "30000.00")
        self.post(
            "readiness/funding-plans",
            {
                **self.context(),
                "allocations": [{"source_id": source["id"], "amount": "20000.00"}],
            },
            400,
        )

    def test_late_funding_cannot_cover_early_gap(self):
        self.revise()
        self.post(
            "funding-sources",
            {
                "economic_key": "late",
                "kind": "family",
                "currency": "THB",
                "amount": "50000.00",
                "available_on": "2026-08-30",
                "certainty": "confirmed",
            },
        )
        result = self.post("readiness/funding-plans/recommend", self.context())[
            "result"
        ]
        self.assertEqual(result["recommended_borrowing_net"], "50000.00")

    def test_model_outage_keeps_risks_and_retries(self):
        self.revise()
        with patch(
            "finance.readiness.adapter.ai_client",
            side_effect=ConnectionError("unavailable"),
        ):
            for _ in range(10):
                if not run_one(self.user):
                    break
        self.assertTrue(
            ReadinessJob.objects.filter(owner=self.user, status="RETRY").exists()
        )
        self.assertTrue(
            NotificationOutbox.objects.filter(
                owner=self.user, risk__active=True
            ).exists()
        )

    def test_expired_check_lease_is_fenced(self):
        from finance.readiness.adapter import DjangoReadinessBackend
        from finance.readiness.models import CheckLease

        first, second = (
            DjangoReadinessBackend(self.user),
            DjangoReadinessBackend(self.user),
        )
        self.assertTrue(first.claim_readiness_check("lease"))
        CheckLease.objects.filter(key="lease").update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertTrue(second.claim_readiness_check("lease"))
        first.release_readiness_check("lease")
        self.assertGreater(
            CheckLease.objects.get(key="lease").expires_at, timezone.now()
        )

    def test_prompt_injection_cannot_be_confirmed(self):
        semester = Semester.objects.get(pk=self.semester_id)
        material = ImportMaterial.objects.create(
            owner=self.user,
            semester=semester,
            content=b"ignored",
            sha256="a" * 64,
            kind="text",
            status="NEEDS_REVIEW",
            state_version=1,
            budget_version=1,
            result={"issues": [{"code": "UNTRUSTED_INSTRUCTIONS"}]},
        )
        self.post(
            "readiness/imports/" + str(material.id) + "/confirm",
            {
                **self.context(),
                "draft": self.complete_draft(),
                "issuer": "PSU",
                "selected_cost_ids": ["tuition"],
                "conflict_resolutions": {"tuition": "approve"},
            },
            400,
        )

    def test_amount_change_requires_explicit_review(self):
        semester = Semester.objects.get(pk=self.semester_id)
        material = ImportMaterial.objects.create(
            owner=self.user,
            semester=semester,
            content=b"invoice",
            sha256="b" * 64,
            kind="text",
            status="NEEDS_REVIEW",
            state_version=1,
            budget_version=1,
            result={},
        )
        self.post(
            "readiness/imports/" + str(material.id) + "/confirm",
            {
                **self.context(),
                "draft": self.complete_draft("650000.00"),
                "issuer": "PSU",
                "selected_cost_ids": ["tuition"],
            },
            400,
        )

    def test_foreign_beneficiary_rejected(self):
        from finance.workflow_models import Beneficiary

        beneficiary = Beneficiary.objects.create(
            owner=self.other, name="other", destination_label="private", verified=True
        )
        draft = self.complete_draft()
        draft["costs"][0]["beneficiary_id"] = str(beneficiary.id)
        self.post("readiness/semesters/revise", {**self.context(), "draft": draft}, 404)

    def test_beneficiary_change_revokes_verification_and_invalidates_state(self):
        from finance.workflow_models import Beneficiary

        beneficiary = Beneficiary.objects.create(
            owner=self.user,
            name="School",
            destination_label="School account",
            verified=True,
        )
        before = current(self.user).version
        result = self.post(
            "readiness/beneficiaries/" + str(beneficiary.id) + "/update",
            {
                "state_version": before,
                "name": "School",
                "destination_label": "New account",
            },
        )
        self.assertFalse(result["verified"])
        self.assertGreater(current(self.user).version, before)

    def test_daily_scheduler_uses_bangkok_day_and_deduplicates(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo

        from finance.readiness.jobs import schedule_daily

        before = ReadinessJob.objects.count()
        morning = datetime(2026, 8, 2, 8, tzinfo=ZoneInfo("Asia/Bangkok"))
        with patch(
            "finance.readiness.services.business_date", return_value=morning.date()
        ):
            schedule_daily(morning - timedelta(hours=1))
            self.assertEqual(ReadinessJob.objects.count(), before)
            schedule_daily(morning)
            schedule_daily(morning)
        self.assertEqual(ReadinessJob.objects.count(), before + 1)

    def test_expired_fx_leaves_budget_incomplete(self):
        from finance.workflow_models import FXQuote

        quote = FXQuote.objects.create(
            owner=self.user,
            source_currency="USD",
            target_currency="THB",
            rate="35",
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        draft = self.complete_draft("1000.00")
        draft["costs"][0].update(currency="USD", fx_quote_id=str(quote.id))
        self.revise(draft)
        result = self.post("readiness/budgets", self.context())["result"]
        self.assertFalse(result["complete"])
        self.assertIn("FX_EXPIRED:tuition", result["issues"])

    def test_invoice_identity_conflict_and_cross_material_duplicate(self):
        from rest_framework.exceptions import ValidationError

        from finance.readiness.imports import check_invoice

        semester = Semester.objects.get(pk=self.semester_id)
        first = ImportMaterial.objects.create(
            owner=self.user,
            semester=semester,
            content=b"one",
            sha256="c" * 64,
            kind="text",
            state_version=1,
            budget_version=1,
        )
        second = ImportMaterial.objects.create(
            owner=self.user,
            semester=semester,
            content=b"two",
            sha256="d" * 64,
            kind="text",
            state_version=1,
            budget_version=1,
        )
        cost = {
            "invoice_id": "INV-1",
            "amount": "65000.00",
            "currency": "THB",
            "due_date": "2026-08-10",
        }
        check_invoice(self.user, first, "PSU", cost)
        check_invoice(self.user, first, "PSU", cost)
        with self.assertRaises(ValidationError):
            check_invoice(self.user, second, "PSU", cost)
        with self.assertRaises(ValidationError):
            check_invoice(self.user, second, "PSU", {**cost, "amount": "650000.00"})
