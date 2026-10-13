"""The short planning flow must retain exact money, missing data and lending guards."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connections
from rest_framework.test import APIClient, APITestCase, APITransactionTestCase

from finance.models import FinancialState
from finance.planning import catalog, services
from finance.services import save_state
from finance.workflow_models import DemoWallet, LoanSimulation, SimulatedApplication


class ShortPlanningTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user("short-plan", password="testing-plan-17")
        self.client.force_authenticate(self.user)
        self.plan = services.save_plan(self.user, {"school_key": "psu-phuket"})["plan"]

    def post(self, route, data, key=None):
        return self.client.post("/api/v2/planning/" + route, data, format="json",
                                HTTP_IDEMPOTENCY_KEY=key or str(uuid4()))

    def inputs(self):
        return {"available_funds": "10000.00", "funds_currency": "THB", "reserve": "0.00",
                "as_of": "2027-08-01", "horizon": 90, "payment_date": "2027-08-08",
                "supports": [], "repayment": {"income": "30000.00", "living_expenses": "10000.00",
                "existing_repayments": "0.00", "from_month": "2027-09", "to_month": "2031-08",
                "changes": []}, "loan": {"principal": "20000.00", "annual_rate": "0.06",
                "fees": "0.00", "first_due_date": "2027-09-01", "periods": [48, 24]}}

    def save(self, inputs=None, version=0):
        response = self.post("assessment/", {"expected_version": version,
            "plan_version": self.plan["version"], "inputs": inputs or self.inputs()})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["data"]

    def test_commercial_study_example_survives_quote_and_application(self):
        inputs = self.inputs()
        inputs["loan"].update(product="commercial_student_demo", annual_rate="0.075", fees="300.00")
        result = self.save(inputs)
        self.assertEqual(result["inputs"]["loan"]["product"], "commercial_student_demo")
        self.assertEqual([q["inputs"]["months"] for q in result["quotes"]], [48, 24, 48])
        self.assertEqual([q["inputs"]["product"] for q in result["quotes"]],
                         ["custom", "custom", "commercial_student_demo"])
        self.assertEqual(len({q["id"] for q in result["quotes"]}), 3)
        for quote in result["quotes"]:
            self.assertEqual(Decimal(quote["inputs"]["annual_rate"]), Decimal("0.075"))
            self.assertEqual(quote["result"]["net_proceeds"], "19700.00")
        quote = result["quotes"][2]
        response = self.post("loan-applications/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "quote_id": quote["id"]})
        self.assertEqual(response.status_code, 201, response.data)
        application = SimulatedApplication.objects.get(pk=response.data["data"]["application"]["id"])
        self.assertEqual(str(application.loan_id), quote["id"])
        inputs["loan"]["product"] = "custom"
        self.save(inputs, result["version"])
        application.refresh_from_db()
        self.assertEqual(application.loan.inputs["product"], "commercial_student_demo")

    def test_loan_product_defaults_and_validation(self):
        result = self.save()
        self.assertEqual(result["quotes"][0]["inputs"]["product"], "custom")
        inputs = self.inputs()
        inputs["loan"]["product"] = "unverified_bank_product"
        response = self.post("assessment/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "inputs": inputs})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(LoanSimulation.objects.filter(owner=self.user).count(), 3)

    def test_standalone_commercial_example_and_unknown_product(self):
        body = {key: value for key, value in self.inputs()["loan"].items() if key != "periods"}
        body.update(product="commercial_student_demo", months=48, currency="THB")
        response = self.client.post("/api/v2/loans/", body, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["data"]["inputs"]["product"], "commercial_student_demo")
        body["product"] = "unverified_bank_product"
        response = self.client.post("/api/v2/loans/", body, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code, 400)

    def test_catalog_uses_actual_months_and_semesters(self):
        result = services.estimate(catalog.school("psu-phuket"))
        tuition = next(r for r in result["lines"] if r["cost_id"] == "tuition_semester")
        self.assertEqual(result["duration_months"], 42)
        self.assertEqual(tuition["occurrences"], 10)
        self.assertEqual(Decimal(tuition["total"]), Decimal("410000.00"))

    def test_unknown_cost_is_not_zero_or_complete(self):
        raw = catalog.school("psu-phuket").model_dump(mode="json")
        raw["costs"][0].update(amount=None, lower=None, upper=None, status="missing", estimate=True)
        result = services.estimate(catalog.Entry.model_validate(raw))
        self.assertFalse(result["complete"])
        self.assertIn("tuition_semester", result["missing_cost_ids"])
        self.assertIsNone(result["lines"][0]["total"])

    def test_assessment_is_isolated_and_returns_three_choices(self):
        result = self.save()
        self.assertFalse(FinancialState.objects.filter(owner=self.user).exists())
        self.assertFalse(DemoWallet.objects.filter(owner=self.user).exists())
        self.assertEqual([r["inputs"]["months"] for r in result["quotes"]], [48, 24, 48])
        self.assertEqual([r["inputs"]["product"] for r in result["quotes"]],
                         ["custom", "custom", "commercial_student_demo"])
        self.assertTrue(all(r["assessment"]["status"] == "AFFORDABLE" for r in result["quotes"]))
        self.assertEqual(result["inputs"]["repayment"]["income"], "30000.00")
        self.assertEqual(result["forecast"]["horizon"], 90)

    def test_unconfirmed_support_only_changes_conditional_forecast(self):
        data = self.inputs()
        data["supports"] = [{"id": "family", "amount": "200000.00", "currency": "THB",
                             "available_on": "2027-08-02", "confirmed": False}]
        result = self.save(data)
        self.assertGreater(Decimal(result["forecast"]["maximum_reserve_gap"]),
                           Decimal(result["conditional_forecast"]["maximum_reserve_gap"]))

    def test_missing_repayment_months_stay_unknown(self):
        data = self.inputs()
        data["repayment"]["to_month"] = "2027-10"
        result = self.save(data)
        self.assertEqual(result["quotes"][0]["assessment"]["status"], "INSUFFICIENT_DATA")
        self.assertIn("2027-11.income", result["quotes"][0]["assessment"]["missing_inputs"])

    def test_revision_conflict_and_get_do_not_create_quotes(self):
        self.save()
        count = LoanSimulation.objects.filter(owner=self.user).count()
        self.client.get("/api/v2/planning/assessment/")
        self.assertEqual(LoanSimulation.objects.filter(owner=self.user).count(), count)
        response = self.post("assessment/", {"expected_version": 0,
            "plan_version": self.plan["version"], "inputs": self.inputs()})
        self.assertEqual(response.status_code, 409)

    def test_one_confirmation_submits_once_and_preserves_wallet(self):
        state = save_state(self.user, 0, {"currency": "THB", "as_of": "2027-08-01",
            "opening_balance": "1000.00", "reserve": "0.00", "events": []})
        wallet = DemoWallet.objects.create(owner=self.user, initial_state=state,
                                          balance="1000.00", clock=date(2027, 8, 1))
        result = self.save()
        payload = {"expected_version": result["version"], "plan_version": self.plan["version"],
                   "quote_id": result["quotes"][0]["id"]}
        first = self.post("loan-applications/", payload, "submit-once")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["data"]["application"]["status"], "APPROVED")
        second = self.post("loan-applications/", payload, "submit-once")
        self.assertEqual(second.status_code, 200)
        third = self.post("loan-applications/", payload)
        self.assertEqual(third.data["data"]["application"]["id"], first.data["data"]["application"]["id"])
        self.assertEqual(SimulatedApplication.objects.filter(owner=self.user).count(), 1)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("1000.00"))

    def test_changed_inputs_cannot_submit_old_quote(self):
        result = self.save()
        changed = deepcopy(self.inputs())
        changed["loan"]["principal"] = "25000.00"
        self.save(changed, 1)
        response = self.post("loan-applications/", {"expected_version": 2,
            "plan_version": self.plan["version"], "quote_id": result["quotes"][0]["id"]})
        self.assertEqual(response.status_code, 400)

        legacy = self.client.post("/api/v2/applications/", {"quote_id": result["quotes"][0]["id"]},
            format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(legacy.status_code, 400)
        self.assertEqual(legacy.data["code"], "PLANNING_ASSESSMENT_STALE")

    def test_cost_edit_updates_total_and_forecast_without_changing_catalog(self):
        original = services.estimate(catalog.school("psu-phuket"))
        inputs = self.inputs()
        inputs["costs"] = [{"cost_id": "tuition_semester", "amount": "51000.00"}]
        result = self.save(inputs)
        self.assertEqual(Decimal(result["estimate"]["total"]) - Decimal(original["total"]), Decimal("100000.00"))
        self.assertEqual(services.estimate(catalog.school("psu-phuket"))["total"], original["total"])

    def test_unknown_gap_does_not_use_course_cost_as_principal(self):
        inputs = self.inputs()
        inputs["available_funds"] = None
        inputs["loan"]["principal"] = None
        result = self.save(inputs)
        self.assertFalse(result["forecast"]["complete"])
        self.assertIsNone(result["suggested_principal"])
        self.assertEqual(result["quotes"], [])

    def test_draft_save_does_not_quote_or_mutate_formal_plan(self):
        result = self.post("assessment/", {"expected_version": 0, "plan_version": self.plan["version"],
            "inputs": self.inputs(), "draft": True})
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(LoanSimulation.objects.filter(owner=self.user).count(), 0)
        self.assertEqual(services.plan_for(self.user).status, "DRAFT")

    def test_bills_use_frozen_actual_semesters(self):
        from finance.planning.in_school import generate_bills
        from finance.planning.models import PlanBill
        plan = services.plan_for(self.user)
        plan.snapshot = services.estimate(catalog.school("psu-phuket"))
        plan.save(update_fields=["snapshot"])
        generate_bills(self.user, plan)
        bills = PlanBill.objects.filter(plan=plan, source_id__startswith="tuition_semester:")
        self.assertEqual(bills.count(), 10)
        self.assertEqual(sum(b.amount for b in bills), Decimal("410000.00"))
        generate_bills(self.user, plan)
        self.assertEqual(bills.count(), 10)

    def test_year_specific_fees_and_late_fee_are_in_correct_scope(self):
        result = services.estimate(catalog.school("waseda"))
        tuition = next(r for r in result["lines"] if r["cost_id"] == "tuition_semester")
        alumni = next(r for r in result["lines"] if r["cost_id"] == "alumni_fee")
        self.assertEqual(tuition["total"], "4924000.00")
        self.assertEqual(tuition["per_year"], "1081000.00")
        self.assertEqual(alumni["per_year"], "0.00")
        self.assertEqual(alumni["total"], "40000.00")

    def test_repayment_change_preserves_other_recurring_fields(self):
        data = self.inputs()
        data["repayment"]["changes"] = [{"month": "2027-10", "income": "11000.00"}]
        result = self.save(data)
        rows = result["quotes"][0]["repayment_months"]
        self.assertEqual(rows[1]["income"], "11000.00")
        self.assertEqual(rows[1]["living_expenses"], "10000.00")

    def test_other_user_cannot_submit_quote(self):
        result = self.save()
        other = get_user_model().objects.create_user("planning-other")
        self.client.force_authenticate(other)
        response = self.post("loan-applications/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "quote_id": result["quotes"][0]["id"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(SimulatedApplication.objects.count(), 0)

    def test_external_repayment_change_requires_review_before_application(self):
        from finance.lending_models import AffordabilityProfile
        result = self.save()
        AffordabilityProfile.objects.create(owner=self.user, version=1, months=[])
        current = self.client.get("/api/v2/planning/assessment/").data["data"]
        self.assertTrue(current["stale"])
        response = self.post("loan-applications/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "quote_id": result["quotes"][0]["id"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(SimulatedApplication.objects.count(), 0)

    def test_sufficient_funds_skip_loans_even_with_nonzero_fee(self):
        data = self.inputs()
        data["available_funds"] = "3000000.00"
        data["loan"].update(principal=None, fees="1200.00")
        result = self.save(data)
        self.assertEqual(result["suggested_principal"], "0.00")
        self.assertEqual(result["quotes"], [])

    def test_failed_aggregate_rolls_back_account_initialization(self):
        from unittest.mock import patch

        from rest_framework.exceptions import ValidationError
        result = self.save()
        with patch("finance.lending_applications.application_action", side_effect=ValidationError("submission interrupted")):
            response = self.post("loan-applications/", {"expected_version": result["version"],
                "plan_version": self.plan["version"], "quote_id": result["quotes"][0]["id"]})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(FinancialState.objects.filter(owner=self.user).exists())
        self.assertFalse(DemoWallet.objects.filter(owner=self.user).exists())
        self.assertEqual(SimulatedApplication.objects.count(), 0)




class ShortPlanningConcurrencyTests(APITransactionTestCase):
    def test_aggregate_same_key_and_different_keys_create_one_application(self):
        cache.clear()
        user = get_user_model().objects.create_user("short-parallel")
        plan = services.save_plan(user, {"school_key": "psu-phuket"})["plan"]
        from finance.planning import assessment
        inputs = ShortPlanningTests.inputs(self)
        result = assessment.save(user, {"expected_version": 0, "plan_version": plan["version"], "inputs": inputs})
        body = {"expected_version": result["version"], "plan_version": plan["version"], "quote_id": result["quotes"][0]["id"]}
        barrier = Barrier(4)

        def work(index):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=user.pk))
                barrier.wait(timeout=10)
                response = client.post("/api/v2/planning/loan-applications/", body, format="json",
                    HTTP_IDEMPOTENCY_KEY="same-key" if index < 2 else str(uuid4()))
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=4) as pool:
            statuses = list(pool.map(work, range(4)))
        self.assertTrue(all(code in (200, 201) for code in statuses), statuses)
        self.assertEqual(SimulatedApplication.objects.filter(owner=user).count(), 1)
