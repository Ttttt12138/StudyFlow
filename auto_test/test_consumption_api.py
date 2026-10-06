import io
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase

from finance.consumption.analysis import analyze, refresh
from finance.consumption.models import ObservedTransaction
from finance.readiness.models import Semester
from finance.workflow_common import current
from finance.workflow_models import DemoLedgerEntry, DemoWallet, IdempotencyRecord


@override_settings(
    STUDYFLOW_READINESS_ENABLED=True,
    STUDYFLOW_CONSUMPTION_ENABLED=True,
    STUDYFLOW_AI_MODE="mock",
)
class ConsumptionApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="learning-student")
        self.operator = get_user_model().objects.create_user(
            username="learning-operator", is_staff=True
        )
        self.client.force_authenticate(self.user)
        self.semester = self.post(
            "readiness/semesters",
            {"reserve": "1000", "opening_balance": "100000", "as_of": "2026-10-01"},
        )
        self.post("demo/initialize", {"state_version": self.semester["state_version"]})

    def post(self, route, data, status=201, key=None):
        response = self.client.post(
            "/api/v2/" + route + "/",
            data,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key or uuid4().hex,
        )
        self.assertEqual(response.status_code, status, response.data)
        return response.data.get("data", response.data)

    def context(self):
        semester = Semester.objects.get(pk=self.semester["id"])
        return {
            "semester_id": str(semester.id),
            "state_version": current(self.user).version,
            "budget_version": semester.version,
            "analysis_version": semester.analysis_version,
        }

    def upload(self, content=None):
        text = content or (
            "transaction_id,account_id,date,amount,currency,counterparty,description\n"
            + "\n".join(
                f"{m}-{c},main,2026-{m:02d}-05,{a},THB,{p},{d}"
                for m in (7, 8, 9)
                for c, a, p, d in [
                    ("r", "-9000.00", "Condo", "Monthly rent"),
                    ("f", "-6000.00", "Cafe", "Food"),
                    ("m", "-300.00", "AIS", "Mobile plan"),
                ]
            )
        )
        response = self.client.post(
            "/api/v2/readiness/transaction-imports/",
            {
                "file": SimpleUploadedFile("history.csv", text.encode()),
                "source_type": "synthetic",
            },
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=uuid4().hex,
        )
        self.assertEqual(response.status_code, 202, response.data)
        return response.data["data"]

    def confirm(
        self, batch, complete=True, start="2026-07-01", end="2026-09-30", **extra
    ):
        return self.post(
            "readiness/transaction-imports/" + batch["id"] + "/confirm",
            {
                "selected_rows": [r["locator"] for r in batch["preview"]["rows"]],
                "coverage": [
                    {
                        "account_id": "main",
                        "start": start,
                        "end": end,
                        "complete": complete,
                    }
                ],
                **extra,
            },
        )

    def draft(self):
        draft = deepcopy(Semester.objects.get(pk=self.semester["id"]).draft)
        for c in draft["costs"]:
            c.update(
                conflict=False,
                paid=False,
                synthetic=True,
                valid_until=None,
                source_refs=[],
            )
            if c["cost_id"] == "food":
                c.update(amount="3000.00", period="monthly", applicability="APPLICABLE")
            elif c["cost_id"] == "communications":
                c.update(amount="500.00", period="monthly", applicability="APPLICABLE")
            elif c["cost_id"] == "tuition":
                c.update(amount="10000.00", due_date="2026-10-10")
            else:
                c.update(
                    applicability="NOT_APPLICABLE",
                    applicability_reason="Synthetic scope",
                )
        return draft

    def test_import_calibration_and_recurring_do_not_create_cash(self):
        self.post(
            "readiness/semesters/revise", {**self.context(), "draft": self.draft()}
        )
        wallet = DemoWallet.objects.get(owner=self.user).balance
        batch = self.upload()
        self.confirm(batch)
        self.assertEqual(self.upload()["id"], batch["id"])
        self.assertEqual(ObservedTransaction.objects.count(), 9)
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance, wallet)
        self.assertEqual(DemoLedgerEntry.objects.count(), 0)
        result = refresh(self.user)["result"]
        food = next(c for c in result["costs"] if c["cost_id"] == "food")
        self.assertEqual(food["forecast_amount"], "6000.00")
        self.assertEqual(food["original_amount"], "3000.00")
        original = next(
            c
            for c in Semester.objects.get(pk=self.semester["id"]).draft["costs"]
            if c["cost_id"] == "food"
        )
        self.assertEqual(original["amount"], "3000.00")
        forecast = self.post("readiness/forecasts", {**self.context(), "horizon": 30})[
            "result"
        ]
        self.assertEqual(
            forecast["calibration"]["analysis_version"],
            self.context()["analysis_version"],
        )
        mobile = [
            e
            for e in forecast["timeline"]
            if e["id"].startswith("cost:communications:")
        ]
        self.assertEqual(
            [(e["date"], e["amount"]) for e in mobile], [("2026-10-05", "300.00")]
        )
        briefing = self.client.get("/api/v2/readiness/briefing/").data["data"]
        self.assertIn("spending_increased", briefing["risks"])
        plan = self.post(
            "readiness/funding-plans",
            {
                **self.context(),
                "allocations": [],
                "actions": [
                    {
                        "kind": "reduce_spending",
                        "cost_id": "food",
                        "amount": "1000.00",
                        "evidence": "Explicit spending cap",
                    }
                ],
            },
        )
        adjusted = next(
            c
            for c in plan["result"]["forecast"]["calibration"]["costs"]
            if c["cost_id"] == "food"
        )
        self.assertEqual(adjusted["forecast_amount"], "5000.00")

    def test_partial_coverage_cannot_lower_budget_and_stale_versions(self):
        before = self.context()
        self.confirm(self.upload(), complete=False)
        self.assertFalse(any(c["applied"] for c in analyze(self.user)["costs"]))
        self.post("readiness/forecasts", {**before, "horizon": 30}, status=409)
        result = self.client.get("/api/v2/readiness/briefing/").data["data"]
        self.assertEqual(result["status"], "NEEDS_INFORMATION")

    def test_same_id_across_files_deduplicates(self):
        self.confirm(self.upload())
        batch = self.upload(
            "transaction_id,account_id,date,amount,currency,counterparty,description\n7-r,main,2026-07-05,-9000.00,THB,Condo,Monthly rent\n"
        )
        self.confirm(batch, complete=False)
        self.assertEqual(ObservedTransaction.objects.count(), 9)

    def test_family_cannot_self_confirm_and_token_not_stored(self):
        self.post(
            "funding-sources",
            {
                "economic_key": "fake",
                "kind": "family",
                "currency": "THB",
                "amount": "5000",
                "available_on": "2026-10-01",
                "certainty": "confirmed",
            },
            status=400,
        )
        item = self.post(
            "sponsor-requests",
            {
                "economic_key": "family",
                "amount": "5000",
                "currency": "THB",
                "available_on": "2026-10-01",
                "purpose": "Tuition",
            },
        )
        route = "sponsor-requests/" + item["id"] + "/issue-link"
        self.post(route, {"terms_version": 1}, status=403)
        self.client.force_authenticate(self.operator)
        link = self.post(route, {"terms_version": 1})
        self.assertFalse(
            IdempotencyRecord.objects.filter(response__icontains=link["token"]).exists()
        )
        response = self.client.get(
            "/api/v2/sponsor-confirmation/", HTTP_X_SPONSOR_TOKEN=link["token"]
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            DemoWallet.objects.get(owner=self.user).balance, Decimal(100000)
        )
        response = self.client.post(
            "/api/v2/sponsor-confirmation/",
            {"terms_version": 1, "decision": "confirm"},
            format="json",
            HTTP_X_SPONSOR_TOKEN=link["token"],
            HTTP_IDEMPOTENCY_KEY="decision",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            DemoWallet.objects.get(owner=self.user).balance, Decimal(100000)
        )
        self.post("funding-sources/" + item["source"]["id"] + "/receive", {})
        self.assertEqual(
            DemoWallet.objects.get(owner=self.user).balance, Decimal(105000)
        )

    def test_route_comparison_avoids_late_cheapest_route(self):
        quotes = []
        for days, fee in [(1, "10"), (5, "0")]:
            quotes.append(
                self.post(
                    "fx-quotes",
                    {
                        "source_currency": "USD",
                        "rate": "35",
                        "sender_fee": fee,
                        "receiver_fee": "0",
                        "settlement_days": days,
                        "expires_at": (timezone.now() + timedelta(hours=1)).isoformat(),
                    },
                )["id"]
            )
        result = self.post(
            "remittance-comparisons",
            {
                "quote_ids": quotes,
                "source_currency": "USD",
                "amount": "1000",
                "required_amount": "30000",
                "send_on": "2026-10-01",
                "deadline": "2026-10-03",
            },
        )
        self.assertEqual(result["recommended_quote_id"], quotes[0])
        self.assertEqual(result["routes"][0]["net_received"], "34650.00")

    def test_templates_are_versioned_and_image_requires_manual_input(self):
        templates = self.client.get("/api/v2/readiness/templates/").data["data"]
        self.assertEqual(len(templates), 3)
        self.assertTrue(any(t["synthetic"] for t in templates))
        image = io.BytesIO()
        Image.new("RGB", (20, 20), "white").save(image, format="PNG")
        response = self.client.post(
            "/api/v2/readiness/imports/",
            {
                **self.context(),
                "kind": "image",
                "file": SimpleUploadedFile("scan.png", image.getvalue()),
            },
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=uuid4().hex,
        )
        self.assertEqual(response.status_code, 202, response.data)
        from finance.readiness.imports import process_material
        from finance.readiness.models import ImportMaterial, ReadinessJob

        material = ImportMaterial.objects.get(pk=response.data["data"]["id"])
        job = ReadinessJob.objects.get(kind="import", owner=self.user)
        job.lease_token = uuid4()
        job.save()
        result = process_material(job)
        self.assertEqual(result["status"], "NEEDS_MANUAL_INPUT")
        material.refresh_from_db()
        self.assertEqual(material.status, "NEEDS_MANUAL_INPUT")
        self.post(
            "readiness/imports/" + str(material.id) + "/transcribe",
            {
                **self.context(),
                "text": "Synthetic tuition invoice: 10000 THB due 2026-10-10.",
            },
        )
        material.refresh_from_db()
        self.assertEqual(material.status, "QUEUED")
        transcription = ReadinessJob.objects.get(
            key="transcription:" + str(material.id)
        )
        transcription.lease_token = uuid4()
        transcription.save()
        process_material(transcription)
        material.refresh_from_db()
        self.assertEqual(material.status, "NEEDS_REVIEW")
        self.assertEqual(material.result["source_type"], "user_transcription")

    def test_balance_confirmation_is_planning_only_and_refreshes_freshness(self):
        self.post("demo/clock", {"date": "2026-10-10"})
        batch = self.upload(
            "transaction_id,account_id,date,amount,currency,counterparty,description\n"
            "oct-food,main,2026-10-05,-50,THB,Cafe,Food\n"
        )
        self.confirm(batch, complete=False, start="2026-10-01", end="2026-10-09")
        old = self.post("readiness/forecasts", {**self.context(), "horizon": 30})[
            "result"
        ]
        self.assertIn("BALANCE_PRECEDES_OBSERVATIONS", old["data_issues"])
        before = DemoWallet.objects.get(owner=self.user).balance
        self.post(
            "readiness/balance-confirmations",
            {
                "state_version": self.context()["state_version"],
                "as_of": "2026-10-10",
                "amount": "12000.00",
            },
        )
        result = self.post("readiness/forecasts", {**self.context(), "horizon": 30})[
            "result"
        ]
        self.assertNotIn("BALANCE_SNAPSHOT_STALE", result["data_issues"])
        self.assertEqual(
            self.client.get("/api/v2/readiness/state/").data["data"]["assets"][
                "planning_balance"
            ],
            "12000.00",
        )
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance, before)
        self.assertEqual(DemoLedgerEntry.objects.count(), 0)

    def confirmed_invoice(self):
        from finance.readiness.models import ImportMaterial

        beneficiary = self.post(
            "beneficiaries",
            {"name": "Synthetic university", "destination_label": "DEMO-ONLY"},
        )
        self.client.force_authenticate(self.operator)
        self.post("beneficiaries/" + beneficiary["id"] + "/verify", {"verified": True})
        self.client.force_authenticate(self.user)
        draft = self.draft()
        tuition = next(c for c in draft["costs"] if c["cost_id"] == "tuition")
        tuition.update(invoice_id="SYNTHETIC-INV-1", beneficiary_id=beneficiary["id"])
        material = ImportMaterial.objects.create(
            owner=self.user,
            semester_id=self.semester["id"],
            kind="text",
            content=b"Synthetic tuition invoice",
            sha256="a" * 64,
            status="NEEDS_REVIEW",
            state_version=self.context()["state_version"],
            budget_version=self.context()["budget_version"],
        )
        self.post(
            "readiness/imports/" + str(material.id) + "/confirm",
            {
                **self.context(),
                "draft": draft,
                "issuer": "Synthetic University",
                "selected_cost_ids": ["tuition"],
                "conflict_resolutions": {"tuition": "Synthetic invoice confirmed"},
            },
        )
        self.confirm(self.upload())
        refresh(self.user)
        plan = self.post(
            "readiness/funding-plans", {**self.context(), "allocations": []}
        )
        self.assertEqual(plan["result"]["validation"], "VALID", plan)
        return self.post(
            "payments",
            {
                "readiness_plan_id": plan["id"],
                "beneficiary_id": beneficiary["id"],
                "event_id": "cost:tuition:2026-10-10",
            },
        )

    def settle(self, payment):
        self.post(
            "payments/" + payment["id"] + "/authorize",
            {"state_version": self.context()["state_version"]},
        )
        self.post("payments/" + payment["id"] + "/submit", {})
        self.client.force_authenticate(self.operator)
        self.post(
            "payments/" + payment["id"] + "/adapter-event", {"outcome": "unknown"}
        )
        settled = self.post(
            "payments/" + payment["id"] + "/adapter-event", {"outcome": "settled"}
        )
        self.post(
            "payments/" + payment["id"] + "/adapter-event", {"outcome": "settled"}
        )
        self.client.force_authenticate(self.user)
        return settled

    def test_readiness_tuition_receipt_reconciles_once(self):
        payment = self.confirmed_invoice()
        settled = self.settle(payment)
        self.assertEqual(settled["receipt"]["invoice_id"], "SYNTHETIC-INV-1")
        result = self.post("payments/" + payment["id"] + "/reconcile", {})
        self.assertEqual(result["status"], "reconciled")
        self.assertEqual(
            DemoLedgerEntry.objects.filter(payment_id=payment["id"]).count(), 1
        )
        calendar = self.client.get("/api/v2/readiness/calendar/").data["data"][
            "calendar"
        ]
        self.assertEqual(
            next(e for e in calendar if e["id"] == "cost:tuition:2026-10-10")["status"],
            "paid",
        )

    def test_invoice_mismatch_is_visible_and_analysis_change_invalidates_authorization(
        self,
    ):
        from finance.workflow_models import Payment

        payment = self.confirmed_invoice()
        self.post(
            "payments/" + payment["id"] + "/authorize",
            {"state_version": self.context()["state_version"]},
        )
        tx = ObservedTransaction.objects.filter(category="Food").first()
        self.post(
            "readiness/transactions/" + str(tx.id) + "/revise",
            {"category": "Food", "reason": "Reviewed"},
        )
        self.post("payments/" + payment["id"] + "/submit", {}, status=409)
        self.post("payments/" + payment["id"] + "/cancel", {})
        plan = self.post(
            "readiness/funding-plans", {**self.context(), "allocations": []}
        )
        payment = self.post(
            "payments",
            {
                "readiness_plan_id": plan["id"],
                "beneficiary_id": payment["beneficiary"],
                "event_id": "cost:tuition:2026-10-10",
            },
        )
        self.settle(payment)
        obj = Payment.objects.get(pk=payment["id"])
        obj.receipt["invoice_id"] = "WRONG"
        obj.save()
        self.assertEqual(
            self.post("payments/" + payment["id"] + "/reconcile", {})["status"],
            "reconciliation_exception",
        )

    def test_sponsor_rotation_revocation_expiry_and_idempotent_confirmation(self):
        from finance.sponsorship import SponsorRequest

        item = self.post(
            "sponsor-requests",
            {
                "economic_key": "family",
                "amount": "5000",
                "currency": "THB",
                "available_on": "2026-10-01",
                "purpose": "Tuition",
            },
        )
        self.client.force_authenticate(self.operator)
        route = "sponsor-requests/" + item["id"] + "/issue-link"
        first = self.post(route, {"terms_version": 1})
        second = self.post(route, {"terms_version": 1})
        self.assertEqual(
            self.client.get(
                "/api/v2/sponsor-confirmation/", HTTP_X_SPONSOR_TOKEN=first["token"]
            ).status_code,
            403,
        )
        self.assertEqual(SponsorRequest.objects.get(pk=item["id"]).status, "PENDING")
        args = {
            "format": "json",
            "HTTP_X_SPONSOR_TOKEN": second["token"],
            "HTTP_IDEMPOTENCY_KEY": "same",
        }
        body = {"terms_version": 1, "decision": "confirm"}
        for _ in range(2):
            self.assertEqual(
                self.client.post(
                    "/api/v2/sponsor-confirmation/", body, **args
                ).status_code,
                200,
            )
        self.assertEqual(
            self.client.post(
                "/api/v2/sponsor-confirmation/", {**body, "decision": "reject"}, **args
            ).status_code,
            400,
        )
        self.client.force_authenticate(self.user)
        self.post(
            "sponsor-requests/" + item["id"] + "/revise",
            {"terms_version": 1, "action": "revoke"},
        )
        self.assertEqual(
            self.client.get(
                "/api/v2/sponsor-confirmation/", HTTP_X_SPONSOR_TOKEN=second["token"]
            ).status_code,
            403,
        )
        detail = self.client.get("/api/v2/sponsor-requests/" + item["id"] + "/").data[
            "data"
        ]
        self.assertNotIn("token_digest", detail)
        self.assertNotIn("token_generation", detail)

    def test_partial_invalid_rows_and_legitimate_same_amount(self):
        batch = self.upload(
            "account_id,date,amount,currency,counterparty,description\n"
            "main,2026-09-05,-50,THB,Cafe,Food\nmain,2026-09-05,-50,THB,Cafe,Food\n"
            "main,2026-09-05,-1,USD,Cafe,Food\n"
        )
        self.assertEqual(len(batch["preview"]["issues"]), 1)
        self.confirm(batch, complete=False, keep_similar_rows=["row:3"])
        self.assertEqual(ObservedTransaction.objects.count(), 2)

    def test_refund_link_and_cross_user_isolation(self):
        self.confirm(self.upload())
        batch = self.upload(
            "transaction_id,account_id,date,amount,currency,counterparty,description\n"
            "refund,main,2026-09-20,200,THB,Cafe,Food refund\n"
        )
        self.confirm(batch, complete=False)
        refund = ObservedTransaction.objects.get(external_id="refund")
        purchase = ObservedTransaction.objects.get(external_id="9-f")
        self.post(
            "readiness/transactions/" + str(refund.id) + "/revise",
            {
                "category": "Refund",
                "refund_of": str(purchase.id),
                "reason": "Matched receipt",
            },
        )
        self.assertFalse(ObservedTransaction.objects.get(pk=refund.id).needs_review)
        self.client.force_authenticate(self.operator)
        self.post(
            "readiness/transactions/" + str(refund.id) + "/revise",
            {"category": "Food", "reason": "Not mine"},
            status=404,
        )

    def test_template_upgrade_requires_explicit_confirmation(self):
        before = Semester.objects.get(pk=self.semester["id"])
        body = {
            **self.context(),
            "template_key": "demo-bangkok-international-2026-1",
            "template_version": 1,
        }
        preview = self.post("readiness/templates/upgrade", {**body, "confirm": False})
        self.assertTrue(preview["requires_confirmation"])
        self.assertEqual(
            Semester.objects.get(pk=before.pk).template_key, before.template_key
        )
        result = self.post("readiness/templates/upgrade", {**body, "confirm": True})
        self.assertEqual(result["template_key"], body["template_key"])
        self.assertEqual(result["draft"]["costs"], before.draft["costs"])

    def test_legacy_family_migration_preserves_received_and_opening_funds(self):
        from importlib import import_module

        from django.apps import apps

        from finance.workflow_models import FundingSource

        for key, received, opening in [
            ("pending", False, False),
            ("received", True, False),
            ("opening", False, True),
        ]:
            FundingSource.objects.create(
                owner=self.user,
                economic_key=key,
                kind="family",
                currency="THB",
                amount="100",
                available_on="2026-10-01",
                certainty="confirmed",
                received=received,
                already_in_opening=opening,
            )
        migration = import_module("finance.migrations.0010_unverified_family_support")
        migration.downgrade_unconfirmed(apps, None)
        values = dict(
            FundingSource.objects.filter(owner=self.user).values_list(
                "economic_key", "certainty"
            )
        )
        self.assertEqual(
            values,
            {"pending": "estimated", "received": "confirmed", "opening": "confirmed"},
        )
