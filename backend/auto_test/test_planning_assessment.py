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
from finance.planning.models import PlanBill
from finance.services import save_state
from finance.workflow_models import DemoWallet, Disbursement, LoanSimulation, SimulatedApplication


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
        self.assertEqual([(q["inputs"]["months"], q["inputs"]["product"]) for q in result["quotes"]],
                         [(48, "commercial_student_demo")])
        quote = result["quotes"][0]
        # The study loan keeps its own lower rate whatever rate is declared for the custom loan.
        self.assertEqual(Decimal(quote["inputs"]["annual_rate"]), Decimal("0.045"))
        self.assertEqual(quote["result"]["net_proceeds"], "19700.00")
        response = self.post("loan-applications/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "quote_id": quote["id"]})
        self.assertEqual(response.status_code, 201, response.data)
        application = SimulatedApplication.objects.get(pk=response.data["data"]["application"]["id"])
        self.assertEqual(str(application.loan_id), quote["id"])
        inputs["loan"]["product"] = "custom"
        self.save(inputs, result["version"])
        application.refresh_from_db()
        self.assertEqual(application.loan.inputs["product"], "commercial_student_demo")

    def test_study_loan_has_a_lower_rate_and_the_only_60_month_term(self):
        result = self.save()
        offers = {o["key"]: o for o in result["prequal"]["products"]}
        self.assertEqual((offers["custom"]["annual_rate"], offers["custom"]["terms"]), ("0.06", [24, 36, 48]))
        self.assertEqual((offers["commercial_student_demo"]["annual_rate"], offers["commercial_student_demo"]["terms"]),
                         ("0.045", [24, 36, 48, 60]))
        data = self.inputs()
        data["loan"]["months"] = 60
        custom = self.post("assessment/", {"expected_version": result["version"], "plan_version": self.plan["version"], "inputs": data})
        self.assertEqual(custom.status_code, 400, custom.data)
        data["loan"]["product"] = "commercial_student_demo"
        study = self.save(data, version=result["version"])
        self.assertEqual((study["quotes"][0]["inputs"]["months"], Decimal(study["quotes"][0]["inputs"]["annual_rate"])), (60, Decimal("0.045")))
        preview = lambda product: self.client.post("/api/v2/planning/loan-preview/", {"principal": "20000.00", "months": 60,
                                                                                      "product": product}, format="json")
        self.assertEqual(preview("custom").status_code, 400)
        cheap, normal = preview("commercial_student_demo").data["data"], self.client.post(
            "/api/v2/planning/loan-preview/", {"principal": "20000.00", "months": 48}, format="json").data["data"]
        self.assertEqual(cheap["annual_rate"], "0.045")
        self.assertLess(Decimal(cheap["monthly_payment"]), Decimal(normal["monthly_payment"]))

    def test_study_loan_pays_interest_only_while_studying_then_equal_installments(self):
        from finance.lending_core.calculations import calculate
        from finance.lending_core.schemas import QuoteInput

        # Arithmetic: interest-only rows carry no principal; the equal installments that follow repay all of it.
        terms = QuoteInput(principal=Decimal("12000.00"), annual_rate=Decimal("0.06"), fees=Decimal("0.00"), months=12,
                           first_due_date=date(2027, 9, 1), grace_months=3)
        rows, plain = calculate(terms)["repayments"], calculate(terms.model_copy(update={"grace_months": 0}))["repayments"]
        self.assertEqual(len(rows), 15)
        self.assertEqual({(r["principal"], r["amount"], r["remaining_principal"]) for r in rows[:3]}, {("0.00", "60.00", "12000.00")})
        self.assertEqual([r["amount"] for r in rows[3:]], [r["amount"] for r in plain])
        self.assertEqual((rows[3]["due_date"], rows[-1]["remaining_principal"]), ("2027-12-01", "0.00"))
        self.assertEqual(sum(Decimal(r["principal"]) for r in rows), Decimal("12000.00"))

        # Product rules: only the study loan offers it; the custom loan is refused.
        body = {"principal": "20000.00", "months": 48, "method": "interest_only"}
        refused = self.client.post("/api/v2/planning/loan-preview/", {**body, "product": "custom"}, format="json")
        self.assertEqual((refused.status_code, refused.data["code"]), (400, "METHOD_NOT_OFFERED"))
        self.save()
        preview = self.client.post("/api/v2/planning/loan-preview/", {**body, "product": "commercial_student_demo"},
                                   format="json").data["data"]
        # PSU Phuket runs 42 months from 2027-08-09; with the first payment on 2027-09-01 every one of them is interest only.
        self.assertEqual((preview["method"], preview["interest_only_months"]), ("interest_only", 42))
        self.assertEqual(len(preview["schedule"]), 42 + 48)
        self.assertEqual(preview["interest_only_payment"], "75.00")
        self.assertEqual(preview["schedule"][42]["due_date"], "2031-03-01")
        self.assertGreater(Decimal(preview["monthly_payment"]), Decimal(preview["interest_only_payment"]))
        offers = {o["key"]: o["methods"] for o in self.save(version=1)["prequal"]["products"]}
        self.assertEqual(offers, {"custom": ["amortized"], "commercial_student_demo": ["amortized", "interest_only"]})

        # The quote, the signed account and its installments follow the same schedule.
        inputs = self.inputs()
        inputs["loan"].update(product="commercial_student_demo", months=48, method="interest_only")
        result = self.save(inputs, version=2)
        quote = result["quotes"][0]
        self.assertEqual((quote["inputs"]["grace_months"], len(quote["result"]["schedule"])), (42, 90))
        self.assertEqual({r["phase"] for r in quote["result"]["schedule"][:42]}, {"interest_only"})
        self.assertEqual(self.confirm(result, quote["id"]).status_code, 201)
        from finance.planning import loan_stage
        from finance.planning.models import StudyTask
        StudyTask.objects.filter(template_key__startswith=loan_stage.PREFIX).update(done=True)
        application = SimulatedApplication.objects.get(owner=self.user)
        signed = self.post("loan/sign/", {"application_id": str(application.id), "expected_version": application.version})
        self.assertEqual(signed.status_code, 201, signed.data)
        account = signed.data["data"]["lifecycle"]["accounts"][0]
        self.assertEqual(len(account["installments"]), 90)
        self.assertEqual((account["installments"][0]["principal"], account["installments"][0]["amount"]), ("0.00", "75.00"))
        self.assertEqual(account["outstanding_principal"], "20000.00")

    def test_loan_product_defaults_and_validation(self):
        result = self.save()
        self.assertEqual(result["quotes"][0]["inputs"]["product"], "custom")
        inputs = self.inputs()
        inputs["loan"]["product"] = "unverified_bank_product"
        response = self.post("assessment/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "inputs": inputs})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(LoanSimulation.objects.filter(owner=self.user).count(), 1)

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

    def test_assessment_is_isolated_and_quotes_the_chosen_term(self):
        result = self.save()
        self.assertFalse(FinancialState.objects.filter(owner=self.user).exists())
        self.assertFalse(DemoWallet.objects.filter(owner=self.user).exists())
        self.assertEqual([(r["inputs"]["months"], r["inputs"]["product"]) for r in result["quotes"]], [(48, "custom")])
        data = self.inputs()
        data["loan"]["months"] = 36
        other = self.save(data, version=result["version"])
        self.assertEqual([r["inputs"]["months"] for r in other["quotes"]], [36])
        self.assertTrue(all(r["assessment"]["status"] == "NOT_ASSESSED" for r in result["quotes"]))
        self.assertEqual(result["inputs"]["repayment"]["income"], "30000.00")
        self.assertEqual(result["forecast"]["horizon"], 90)

    def test_unconfirmed_support_only_changes_conditional_forecast(self):
        data = self.inputs()
        data["supports"] = [{"id": "family", "amount": "200000.00", "currency": "THB",
                             "available_on": "2027-08-02", "confirmed": False}]
        result = self.save(data)
        self.assertGreater(Decimal(result["forecast"]["maximum_reserve_gap"]),
                           Decimal(result["conditional_forecast"]["maximum_reserve_gap"]))

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

    def test_evaluated_funds_become_the_plan_funds_and_its_gap(self):
        draft = self.post("assessment/", {"expected_version": 0, "plan_version": self.plan["version"],
            "inputs": {**self.inputs(), "available_funds": "600000.00"}, "draft": True})
        self.assertEqual(draft.status_code, 201, draft.data)
        self.assertIsNone(services.plan_for(self.user).available_funds)
        result = self.save({**self.inputs(), "available_funds": "600000.00"}, version=1)
        self.assertEqual((result["plan"]["available_funds"], result["plan"]["gap"]), ("600000.00", "413800.00"))
        plan = services.plan_for(self.user)
        self.assertEqual((plan.version, plan.status), (self.plan["version"], "DRAFT"))

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

    def test_other_user_cannot_submit_quote(self):
        result = self.save()
        other = get_user_model().objects.create_user("planning-other")
        self.client.force_authenticate(other)
        response = self.post("loan-applications/", {"expected_version": result["version"],
            "plan_version": self.plan["version"], "quote_id": result["quotes"][0]["id"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(SimulatedApplication.objects.count(), 0)

    def test_loans_default_to_the_full_course_gap(self):
        data = self.inputs()
        data["available_funds"] = "600000.00"
        data["loan"].update(principal=None, fees="1200.00")
        result = self.save(data)
        self.assertEqual(result["suggested_principal"], "413800.00")
        self.assertEqual((result["prequal"]["status"], result["prequal"]["max_principal"]), ("enough", "415000.00"))
        self.assertEqual([q["inputs"]["principal"] for q in result["quotes"]], ["415000.00"])
        data["funds_currency"] = "CNY"
        data["available_funds"] = "100000.00"
        converted = self.save(data, version=result["version"])
        thb = services.convert("100000.00", "CNY", "THB")["amount"]
        self.assertEqual(Decimal(converted["suggested_principal"]), Decimal("1013800.00") - Decimal(thb))

    def confirm(self, assessment, quote_id=None):
        return self.post("plan/confirm/", {"expected_version": assessment["version"], "plan_version": assessment["plan_version"],
                                           "quote_id": quote_id})

    def test_one_confirmation_confirms_the_plan_without_a_loan(self):
        conversation = self.client.post("/api/v2/agent/conversations/", {"locale": "zh"}, format="json",
                                        HTTP_IDEMPOTENCY_KEY=str(uuid4())).data["data"]
        result = self.save()
        response = self.confirm(result)
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data["data"]
        self.assertEqual((data["plan"]["status"], data["application"], data["stale"]), ("CONFIRMED", None, False))
        self.assertEqual(SimulatedApplication.objects.filter(owner=self.user).count(), 0)
        self.assertTrue(PlanBill.objects.filter(owner=self.user).exists())
        turns = self.client.get(f"/api/v2/agent/conversations/{conversation['id']}/").data["data"]["turns"]
        self.assertIn("留学计划已保存", turns[-1]["final_answer"])
        again = self.confirm(data)
        self.assertEqual(again.status_code, 400, again.data)

    def test_one_confirmation_submits_the_chosen_loan_and_confirms_the_plan(self):
        result = self.save()
        quote = result["quotes"][0]
        stale = self.post("plan/confirm/", {"expected_version": result["version"] - 1, "plan_version": result["plan_version"],
                                            "quote_id": quote["id"]})
        self.assertEqual(stale.status_code, 409, stale.data)
        self.assertEqual(services.plan_for(self.user).status, "DRAFT")
        response = self.confirm(result, quote["id"])
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data["data"]
        self.assertEqual(data["plan"]["status"], "CONFIRMED")
        self.assertEqual(data["application"]["loan"], quote["id"])
        self.assertNotEqual(data["application"]["status"], "DRAFT")
        self.assertEqual([a["loan"] for a in data["lifecycle"]["applications"]], [quote["id"]])

    def test_prequal_needs_only_the_funds_and_approves_without_income(self):
        data = self.inputs()
        data["available_funds"] = "600000.00"
        data["loan"]["principal"] = None
        data["repayment"].update(income=None, living_expenses=None)
        unknown = self.save({**data, "available_funds": None})
        self.assertEqual((unknown["prequal"]["status"], unknown["quotes"]), ("unknown", []))
        result = self.save(data, version=unknown["version"])
        self.assertEqual((result["prequal"]["status"], result["prequal"]["max_principal"]), ("enough", "413800.00"))
        self.assertNotIn("room", result["prequal"])
        self.assertEqual(result["quotes"][0]["assessment"]["status"], "NOT_ASSESSED")
        self.assertEqual(self.confirm(result, result["quotes"][0]["id"]).status_code, 201)
        application = SimulatedApplication.objects.get(owner=self.user)
        self.assertEqual((application.status, application.assessment["status"]), ("APPROVED", "PREQUALIFIED"))

    def test_preview_gives_instant_figures_without_storing_anything(self):
        result = self.save({**self.inputs(), "available_funds": "600000.00"})
        before = LoanSimulation.objects.count()
        response = self.client.post("/api/v2/planning/loan-preview/", {"principal": "413800.00", "months": 48}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual(data["monthly_payment"], "9718.11")
        self.assertNotIn("room_share", data)
        self.assertEqual(len(data["schedule"]), 48)
        self.assertEqual(data["schedule"][-1]["remaining_principal"], "0.00")
        self.assertEqual(sum(Decimal(r["principal"]) for r in data["schedule"]), Decimal("413800.00"))
        self.assertEqual((data["annual_rate"], data["net_proceeds"]), ("0.06", "413800.00"))
        self.assertEqual(LoanSimulation.objects.count(), before)
        cap = Decimal(result["prequal"]["max_principal"])
        over = self.client.post("/api/v2/planning/loan-preview/", {"principal": str(cap + 1), "months": 60}, format="json")
        self.assertEqual(over.status_code, 400)

    def test_changing_school_withdraws_the_unsigned_application(self):
        result = self.save()
        self.assertEqual(self.confirm(result, result["quotes"][0]["id"]).status_code, 201)
        application = SimulatedApplication.objects.get(owner=self.user)
        self.assertEqual(application.status, "APPROVED")
        saved = services.save_plan(self.user, {"school_key": "malaya"})
        self.assertTrue(saved["withdrawn_application"])
        application.refresh_from_db()
        self.assertEqual(application.status, "CANCELLED")

    def test_signing_pays_the_school_bill_by_bill_from_the_loan(self):
        from finance.planning import loan_stage
        from finance.planning.models import LoanPayout, StudyTask

        inputs = self.inputs()
        inputs["loan"]["principal"] = "30000.00"
        result = self.save(inputs)
        data = self.confirm(result, result["quotes"][0]["id"]).data["data"]
        application = SimulatedApplication.objects.get(owner=self.user)
        documents = data["loan_stage"]["documents"]
        self.assertEqual([d["key"] for d in documents],
                         ["loan_doc:admission", "loan_doc:identity", "loan_doc:income:student_with_parent"])
        self.assertEqual(documents[2]["title"]["zh"], "共同借款人（家长）收入证明")
        sign = {"application_id": str(application.id), "expected_version": application.version}
        missing = self.post("loan/sign/", sign)
        self.assertEqual(missing.status_code, 400, missing.data)
        StudyTask.objects.filter(template_key__startswith=loan_stage.PREFIX).update(done=True)
        before = dict(PlanBill.objects.filter(owner=self.user).values_list("source_id", "amount"))
        response = self.post("loan/sign/", sign)
        self.assertEqual(response.status_code, 201, response.data)
        application.refresh_from_db()
        self.assertEqual(application.status, "DISBURSED")
        self.assertEqual(Disbursement.objects.get(application=application).status, "school")
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance, Decimal("0"))
        payouts = list(LoanPayout.objects.filter(application=application))
        # Tuition first, in date order: one bill fully, then the part of the next one the loan still covers,
        # split off as its own bill so the family's remaining part stays due.
        self.assertEqual([p.bill.kind for p in payouts], ["tuition", "tuition"])
        self.assertEqual(sum(p.amount for p in payouts), Decimal("30000.00"))
        full, part = payouts
        self.assertEqual(full.bill.amount, before[full.bill.source_id])
        source = part.bill.source_id.removesuffix(":loan")
        self.assertNotEqual(source, part.bill.source_id)
        rest = PlanBill.objects.get(owner=self.user, source_id=source)
        self.assertEqual(rest.amount + part.bill.amount, before[source])
        self.assertEqual(payouts[0].status, "SCHEDULED")
        self.client.post("/api/v2/planning/life/clock/", {"date": payouts[0].due_date.isoformat()}, format="json",
                         HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        payouts[0].refresh_from_db()
        self.assertEqual((payouts[0].status, payouts[0].bill.status), ("PAID", "PAID"))
        rest.refresh_from_db()
        self.assertEqual(rest.status, "DUE")
        # The loans tool moves the same demo date (demo/clock/): it settles the next tranche just the same.
        later = max(payouts[1].due_date, payouts[0].due_date)
        moved = self.client.post("/api/v2/demo/clock/", {"date": later.isoformat()}, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(moved.status_code, 201, moved.data)
        payouts[1].refresh_from_db()
        self.assertEqual((payouts[1].status, payouts[1].bill.status), ("PAID", "PAID"))
        operator = get_user_model().objects.create_user("ops-plan", password="ops-pass-17", is_staff=True)
        self.client.force_authenticate(operator)
        wired = self.client.post(f"/api/v2/applications/{application.id}/disburse/", {"expected_version": application.version},
                                 format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertNotEqual(wired.status_code, 201)
        self.client.force_authenticate(self.user)
        with self.assertRaises(Exception):
            services.save_plan(self.user, {"school_key": "malaya"})

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
        with patch("finance.planning.assessment.planning_decision", side_effect=ValidationError("submission interrupted")):
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
