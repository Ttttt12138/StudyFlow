from copy import deepcopy
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from finance.consumption.analysis import provenance
from finance.models import FinancialState
from finance.readiness.models import ReadinessJob, Semester
from finance.workflow_common import current
from finance.workflow_models import DemoLedgerEntry, DemoWallet, LoanSimulation


@override_settings(
    STUDYFLOW_READINESS_ENABLED=True,
    STUDYFLOW_CONSUMPTION_ENABLED=False,
    STUDYFLOW_AI_MODE="mock",
)
class CopilotTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="copilot-student")
        self.client.force_authenticate(self.user)
        self.post(
            "readiness/semesters",
            {
                "reserve": "1000.00",
                "opening_balance": "10000.00",
                "as_of": "2026-10-01",
            },
        )
        self.post("demo/initialize", {"state_version": current(self.user).version})
        semester = Semester.objects.get(owner=self.user)
        draft = deepcopy(semester.draft)
        draft["profile"].update(start_date="2026-10-01", end_date="2026-11-30")
        for cost in draft["costs"]:
            cost.update(conflict=False, source_refs=[], confidence_type="UNCONFIRMED")
            if cost["cost_id"] == "housing":
                cost.update(
                    amount="7000.00",
                    lower=None,
                    upper=None,
                    period="monthly",
                    paid=False,
                    applicability="APPLICABLE",
                    locked=False,
                )
            else:
                cost.update(
                    applicability="NOT_APPLICABLE", applicability_reason="Fixture"
                )
        self.post("readiness/semesters/revise", {**self.context(), "draft": draft})

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
        semester = Semester.objects.get(owner=self.user)
        return {
            "semester_id": str(semester.id),
            "state_version": current(self.user).version,
            "budget_version": semester.version,
            "analysis_version": semester.analysis_version,
        }

    def simulate(self, changes=None):
        return self.post(
            "readiness/what-if",
            {
                **self.context(),
                "scenarios": [
                    {
                        "name": "Cheaper housing",
                        "costs": changes
                        or [
                            {
                                "cost_id": "housing",
                                "amount": "4000.00",
                                "effective_on": "2026-10-01",
                            }
                        ],
                    }
                ],
            },
        )

    def test_scenario_cost_uses_shared_monetary_precision(self):
        from pydantic import ValidationError

        from finance.copilot.contracts import CostChange

        with self.assertRaises(ValidationError):
            CostChange(
                cost_id="rent", amount="100000000000000.00", effective_on="2026-10-06"
            )

    def test_four_trust_states_and_ranges(self):
        self.assertEqual(
            provenance({"amount": "1", "confidence_type": "UNCONFIRMED"})["status"],
            "Unconfirmed",
        )
        self.assertEqual(
            provenance({"lower": "1", "upper": "2"})["status"], "Estimated"
        )
        self.assertEqual(provenance({})["status"], "Missing")
        self.assertEqual(
            provenance(
                {"amount": "1", "confidence_type": "VERIFIED", "conflict": True}
            )["status"],
            "Unconfirmed",
        )

    def test_simulation_exact_and_no_financial_writes(self):
        before = self.context()
        counts = [
            m.objects.count()
            for m in (FinancialState, ReadinessJob, DemoLedgerEntry, LoanSimulation)
        ]
        result = self.simulate()
        self.assertEqual(result["baseline"]["maximum_reserve_gap"], "5000.00")
        self.assertEqual(result["scenarios"][0]["maximum_reserve_gap"], "0.00")
        self.assertEqual(result["scenarios"][0]["remaining_expenses"], "8000.00")
        self.assertEqual(before, self.context())
        self.assertEqual(
            counts,
            [
                m.objects.count()
                for m in (FinancialState, ReadinessJob, DemoLedgerEntry, LoanSimulation)
            ],
        )
        self.assertEqual(
            str(DemoWallet.objects.get(owner=self.user).balance), "10000.00"
        )

    def test_apply_is_explicit_and_idempotent(self):
        result = self.simulate()
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        cost_diff = next(d for d in preview["diff"] if d["kind"] == "cost")
        self.assertEqual(cost_diff["before"]["amount"], "7000.00")
        self.assertEqual(
            cost_diff["after"]["planned_overrides"][-1]["amount"], "4000.00"
        )
        body = {"confirmation": preview["confirmation"]}
        applied = self.post(route + "/apply", body, key="apply-once")
        replay = self.post(route + "/apply", body, key="apply-once", status=200)
        self.assertEqual(applied, replay)
        self.assertEqual(applied["status"], "APPLIED")
        self.assertEqual(applied["diff"], preview["diff"])
        self.assertEqual(
            str(DemoWallet.objects.get(owner=self.user).balance), "10000.00"
        )

    def test_stale_preview_rejected(self):
        result = self.simulate()
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        self.post("demo/clock", {"date": "2026-10-02"})
        self.post(
            route + "/apply", {"confirmation": preview["confirmation"]}, status=409
        )

    def test_locked_cost_requires_review_without_partial_apply(self):
        semester = Semester.objects.get(owner=self.user)
        next(c for c in semester.draft["costs"] if c["cost_id"] == "housing")[
            "locked"
        ] = True
        semester.save()
        result = self.simulate()
        preview = self.post(
            "readiness/what-if/" + result["id"] + "/apply-preview",
            {"scenario_index": 0},
        )
        self.assertIsNone(preview["confirmation"])
        self.assertTrue(preview["blockers"])
        queue = self.client.get("/api/v2/review-queue/").data["data"]
        self.assertEqual(len(queue["items"]), 1)

    def test_foreign_scenario_hidden(self):
        result = self.simulate()
        other = get_user_model().objects.create_user(username="other-copilot")
        self.client.force_authenticate(other)
        self.assertEqual(
            self.client.get(
                "/api/v2/readiness/what-if/" + result["id"] + "/"
            ).status_code,
            404,
        )

    def test_midmonth_change_is_prorated(self):
        result = self.simulate(
            [{"cost_id": "housing", "amount": "4000.00", "effective_on": "2026-11-16"}]
        )
        self.assertEqual(result["scenarios"][0]["remaining_expenses"], "12500.00")

    def test_three_scenarios_are_independent(self):
        result = self.post(
            "readiness/what-if",
            {
                **self.context(),
                "scenarios": [
                    {
                        "name": "Low",
                        "costs": [
                            {
                                "cost_id": "housing",
                                "amount": "4000",
                                "effective_on": "2026-10-01",
                            }
                        ],
                    },
                    {"name": "No change"},
                    {"name": "No loan", "allow_new_loan": False},
                ],
            },
        )
        self.assertEqual(result["scenarios"][1]["remaining_expenses"], "14000.00")
        self.assertEqual(result["scenarios"][2]["loan_needed"], "0.00")
        self.assertEqual(result["scenarios"][2]["unmet_gap"], "5000.00")

    def test_loan_terms_and_no_approval(self):
        terms = {
            "principal": "20600",
            "fees": "600",
            "annual_rate": "0.12",
            "months": 12,
            "first_due_date": "2026-11-05",
        }
        result = self.post(
            "readiness/what-if",
            {
                **self.context(),
                "scenarios": [
                    {"name": "12", "loan": terms, "loan_available_on": "2026-10-01"},
                    {
                        "name": "24",
                        "loan": {**terms, "months": 24},
                        "loan_available_on": "2026-10-01",
                    },
                ],
            },
        )
        from decimal import Decimal

        first, second = [r["loan"] for r in result["scenarios"]]
        self.assertLess(
            Decimal(second["maximum_installment"]),
            Decimal(first["maximum_installment"]),
        )
        self.assertGreater(
            Decimal(second["total_interest"]), Decimal(first["total_interest"])
        )
        self.assertEqual(first["affordability"]["status"], "INSUFFICIENT_DATA")
        self.assertFalse(LoanSimulation.objects.filter(owner=self.user).exists())
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        applied = self.post(route + "/apply", {"confirmation": preview["confirmation"]})
        self.assertEqual(applied["loan"]["application"]["status"], "DRAFT")
        self.assertEqual(
            str(DemoWallet.objects.get(owner=self.user).balance), "10000.00"
        )

    def test_support_replaces_existing_source_and_applies_pending(self):
        request = self.post(
            "sponsor-requests",
            {
                "economic_key": "family",
                "amount": "3000",
                "currency": "THB",
                "available_on": "2026-10-02",
                "purpose": "tuition",
            },
        )
        result = self.post(
            "readiness/what-if",
            {
                **self.context(),
                "scenarios": [
                    {
                        "name": "Support",
                        "family_support": [
                            {
                                "source_id": request["source"]["id"],
                                "amount": "4000",
                                "available_on": "2026-10-02",
                            }
                        ],
                    }
                ],
            },
        )
        self.assertEqual(result["scenarios"][0]["maximum_reserve_gap"], "1000.00")
        self.assertEqual(
            result["scenarios"][0]["confirmed"]["maximum_reserve_gap"], "5000.00"
        )
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        applied = self.post(route + "/apply", {"confirmation": preview["confirmation"]})
        self.assertEqual(applied["support_requests"][0]["status"], "PENDING")
        self.assertFalse(DemoLedgerEntry.objects.filter(owner=self.user).exists())

    def test_revoked_support_is_excluded_from_current_plan(self):
        request = self.post(
            "sponsor-requests",
            {
                "economic_key": "revoked-family",
                "amount": "3000",
                "currency": "THB",
                "available_on": "2026-10-02",
                "purpose": "tuition",
            },
        )
        from finance.sponsorship import SponsorRequest, revise_request

        item = SponsorRequest.objects.get(pk=request["id"])
        revise_request(self.user, {"action": "revoke", "terms_version": 1}, item)
        result = self.simulate()
        self.assertEqual(result["baseline"]["maximum_reserve_gap"], "5000.00")

    def test_apply_rolls_back_cost_when_support_fails(self):
        from unittest.mock import patch

        from rest_framework.exceptions import ValidationError

        result = self.simulate()
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        before = self.context()
        with patch(
            "finance.copilot.scenarios.apply_support",
            side_effect=ValidationError({"detail": "Injected failure"}),
        ):
            self.post(
                route + "/apply", {"confirmation": preview["confirmation"]}, status=400
            )
        self.assertEqual(before, self.context())
        semester = Semester.objects.get(owner=self.user)
        self.assertFalse(
            next(c for c in semester.draft["costs"] if c["cost_id"] == "housing")[
                "planned_overrides"
            ]
        )

    def test_dependency_hash_handles_uploaded_binary_source(self):
        from finance.readiness.models import ImportMaterial

        ImportMaterial.objects.create(
            owner=self.user,
            semester=Semester.objects.get(owner=self.user),
            kind="image",
            content=b"private bytes",
            sha256="a" * 64,
            state_version=1,
            budget_version=1,
        )
        result = self.simulate()
        self.assertNotIn("private bytes", str(result))

    def test_review_permissions_resolution_and_reopening(self):
        from finance.copilot.models import ReviewItem

        beneficiary = self.post(
            "beneficiaries", {"name": "School", "destination_label": "DEMO-1"}
        )
        item = ReviewItem.objects.get(owner=self.user, entity_id=beneficiary["id"])
        action = {
            "expected_version": item.version,
            "action": "domain_action",
            "reason": "checked",
            "domain_action": "verify_beneficiary",
            "payload": {"verified": True},
        }
        self.post("review-queue/" + str(item.id) + "/actions", action, status=403)
        operator = get_user_model().objects.create_user(
            username="copilot-reviewer", is_staff=True
        )
        self.client.force_authenticate(operator)
        result = self.post("review-queue/" + str(item.id) + "/actions", action)
        self.assertEqual(result["status"], "RESOLVED")
        self.client.force_authenticate(self.user)
        self.post(
            "readiness/beneficiaries/" + beneficiary["id"] + "/update",
            {
                "state_version": self.context()["state_version"],
                "name": "Changed",
                "destination_label": "DEMO-2",
            },
        )
        item.refresh_from_db()
        self.assertEqual(item.status, "OPEN")

    def test_notifications_read_is_idempotent(self):
        from finance.readiness.models import NotificationOutbox, RiskCard

        risk = RiskCard.objects.create(
            owner=self.user,
            semester=Semester.objects.get(owner=self.user),
            kind="test",
            fingerprint="x",
        )
        notification = NotificationOutbox.objects.create(
            owner=self.user, risk=risk, transition="NEW"
        )
        self.assertEqual(
            self.client.get("/api/v2/readiness/notifications/").data["unread_count"], 1
        )
        self.post(
            "readiness/notifications/" + str(notification.id) + "/read", {}, key="read"
        )
        self.post(
            "readiness/notifications/" + str(notification.id) + "/read",
            {},
            key="read",
            status=200,
        )
        self.assertEqual(
            self.client.get("/api/v2/readiness/notifications/").data["unread_count"], 0
        )

    def test_real_provider_attribution_and_cached_calls(self):
        from finance.copilot.explanations import capture
        from finance.copilot.models import ExplanationTrace
        from finance.readiness.models import ReadinessRun

        run = ReadinessRun.objects.create(
            owner=self.user,
            semester=Semester.objects.get(owner=self.user),
            state_version=1,
            budget_version=1,
            kind="check",
            result={
                "trace_id": "test-trace",
                "routing": {
                    "calls": [
                        {
                            "provider": "typesafe",
                            "purpose": "classify",
                            "model": "jev-test",
                            "mode": "live",
                        }
                    ]
                },
                "funding": {
                    "calls": [
                        {
                            "provider": "openai",
                            "purpose": "plan",
                            "model": "llm-test",
                            "mode": "live",
                        }
                    ]
                },
            },
        )
        item = ExplanationTrace.objects.get(trace_id="test-trace")
        self.assertEqual(item.layers["jev"]["calls"][0]["provider"], "typesafe")
        self.assertEqual(item.layers["llm"]["status"], "EXECUTED")
        run.result["reused"] = True
        capture(run)
        item.refresh_from_db()
        self.assertEqual(item.layers["llm"]["status"], "CACHED")

    def test_applied_projection_equals_preview(self):
        result = self.simulate()
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        self.post(route + "/apply", {"confirmation": preview["confirmation"]})
        after = self.post(
            "readiness/what-if",
            {**self.context(), "scenarios": [{"name": "Unchanged"}]},
        )
        self.assertEqual(after["baseline"]["daily"], result["scenarios"][0]["daily"])

    def test_policy_rejection_returns_owned_trace(self):
        response = self.client.post(
            "/api/v2/loans/",
            {"principal": "-1"},
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid4().hex,
        )
        self.assertEqual(response.status_code, 400)
        trace = response["X-StudyFlow-Trace-ID"]
        data = self.client.get("/api/v2/readiness/explanations/" + trace + "/").data[
            "data"
        ]
        self.assertEqual(data["layers"]["policy"]["decision"], "BLOCKED")

    def test_policy_explanation_distinguishes_review_and_authorization(self):
        from finance.copilot.explanations import audit_decision

        self.assertEqual(audit_decision("application.APPROVED"), "ALLOWED")
        self.assertEqual(audit_decision("application.UNDER_REVIEW"), "REVIEW_REQUIRED")
        self.assertEqual(audit_decision("application.REJECTED"), "BLOCKED")
        self.assertEqual(audit_decision("payment.authorized"), "ALLOWED")
        self.assertEqual(audit_decision("payment.invoice_mismatch"), "REVIEW_REQUIRED")
        self.assertIsNone(audit_decision("application.DRAFT_CREATED"))
        self.assertIsNone(audit_decision("beneficiary.mock_verification"))

    def test_no_loan_preference_changes_recommendation_not_debt(self):
        result = self.post(
            "readiness/what-if",
            {
                **self.context(),
                "scenarios": [{"name": "No loan", "allow_new_loan": False}],
            },
        )
        route = "readiness/what-if/" + result["id"]
        preview = self.post(route + "/apply-preview", {"scenario_index": 0})
        self.post(route + "/apply", {"confirmation": preview["confirmation"]})
        recommendation = self.post("readiness/funding-plans/recommend", self.context())[
            "result"
        ]
        self.assertEqual(recommendation["recommended_borrowing_net"], "0.00")
        self.assertEqual(recommendation["unmet_gap"], "5000.00")
        self.assertFalse(recommendation["quote_required"])
