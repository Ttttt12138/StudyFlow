from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase
from .tests import BASE
from .models import FinancialState,AuditEvent
from .workflow_models import *
from .loan_engine import loan_schedule

LOAN = {"currency":"THB","principal":"10000.00","annual_rate":"0.12",
        "months":12,"fees":"1000.00","first_due_date":"2026-11-02"}

class WorkflowTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="student-flow")
        self.operator = get_user_model().objects.create_user(username="demo-operator",is_staff=True)
        self.other = get_user_model().objects.create_user(username="outsider")
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v2/state/",{"expected_version":0,"snapshot":deepcopy(BASE)},format="json")
        self.assertEqual(response.status_code,201)
        self.post("demo/initialize",{"state_version":1})

    def post(self,path,data=None,operator=False,code=201,key=None):
        if path == "fx-quotes":
            data = {"sender_fee":"0","receiver_fee":"0","settlement_days":0,**(data or {})}
        self.client.force_authenticate(self.operator if operator else self.user)
        response = self.client.post("/api/v2/"+path+"/",data or {},format="json",
            HTTP_IDEMPOTENCY_KEY=key or str(uuid4()))
        self.assertEqual(response.status_code,code,str(response.data))
        self.client.force_authenticate(self.user)
        return response.data.get("data",response.data)

    def scenario(self,kind="expected",include=False,overrides=None):
        version = FinancialState.objects.filter(owner=self.user).first().version
        return self.post("scenarios",{"state_version":version,"kind":kind,"end_date":"2026-10-31",
            "include_estimates":include,"overrides":overrides or []})

    def plan(self,allocations=None):
        scenario = self.scenario()
        return self.post("funding-plans",{"scenario_id":scenario["id"],"allocations":allocations or []})

    def source(self,**kwargs):
        data = {"economic_key":str(uuid4()),"kind":"family","currency":"THB","amount":"9000.00",
            "available_on":"2026-10-02","certainty":"confirmed","already_in_opening":False}
        data.update(kwargs)
        return self.post("funding-sources",data)

    def approved(self):
        loan = self.post("loans", LOAN)
        app = self.post("applications", {"quote_id": loan["id"]})
        profile = self.client.get("/api/v2/affordability-profile/").data["data"]
        months = [{"month": row["due_date"][:7], "income": "10000",
                   "living_expenses": "4000", "existing_repayments": "0"}
                  for row in loan["result"]["schedule"]]
        self.post("affordability-profile", {"expected_version": profile["version"], "months": months})
        app = self.post("applications/" + app["id"] + "/action",
                        {"action": "submit", "expected_version": 1})
        self.assertEqual(app["status"], "APPROVED")
        return loan, app, None

    def receive_loan(self):
        loan, app, _ = self.approved()
        self.post("applications/" + app["id"] + "/disburse",
                  {"expected_version": app["version"]}, operator=True, key="disburse-once")
        return loan, app, Disbursement.objects.get(application_id=app["id"])

    def beneficiary(self):
        result = self.post("beneficiaries",{"name":"Demo university","destination_label":"MOCK-UNIVERSITY"})
        self.post("beneficiaries/"+result["id"]+"/verify",{"verified":True},operator=True)
        state = FinancialState.objects.filter(owner=self.user).first()
        snapshot = deepcopy(state.snapshot)
        locked = set(Payment.objects.filter(owner=self.user,status__in=["pending","unknown","settled","reconciled"]).values_list("event_id",flat=True))
        for event in snapshot["events"]:
            if event["kind"] == "expense" and event["id"] not in locked and not event["id"].startswith("repayment:"):
                event["beneficiary_id"] = result["id"]
        response = self.client.post("/api/v2/state/",{"expected_version":state.version,"snapshot":snapshot},format="json")
        self.assertEqual(response.status_code,201,str(response.data))
        return result

    def payment(self,event_id="tuition"):
        beneficiary = self.beneficiary()
        plan = self.plan()
        return self.post("payments",{"plan_id":plan["id"],"beneficiary_id":beneficiary["id"],"event_id":event_id})

    def authorize(self,payment):
        return self.post("payments/"+payment["id"]+"/authorize",{
            "state_version":FinancialState.objects.filter(owner=self.user).first().version})

    def test_three_scenarios_and_revision(self):
        for kind in ["essential","expected","higher_cost"]:
            self.assertEqual(self.scenario(kind)["result"]["maximum_reserve_gap"],"9000.00")
        self.assertEqual(self.scenario()["revision"],2)
        response = self.client.get("/api/v2/scenarios/")
        self.assertEqual(response.data["count"],4)
        scenario = self.scenario()
        self.assertEqual(self.client.get("/api/v2/scenarios/"+scenario["id"]+"/calendar/").status_code,200)

    def test_fx_net_and_date(self):
        quote = self.post("fx-quotes",{"source_currency":"USD","rate":"35",
            "sender_fee":"1.00","receiver_fee":"5.00","settlement_days":1,
            "expires_at":(timezone.now()+timedelta(hours=1)).isoformat()})
        source = self.source(currency="USD",amount="300.00",available_on="2026-10-14")
        plan = self.plan([{"source_id":source["id"],"amount":"300.00","fx_quote_id":quote["id"]}])
        self.assertEqual(plan["result"]["allocations"][0]["net_thb"],"10460.00")
        self.assertEqual(plan["result"]["allocations"][0]["arrival_date"],"2026-10-15")
        self.assertEqual(plan["result"]["feasibility"],"funding_gap") # conservative same-day arrival

    def test_missing_expired_and_wrong_fx(self):
        source = self.source(currency="USD",amount="300.00")
        scenario = self.scenario()
        body = {"scenario_id":scenario["id"],"allocations":[{"source_id":source["id"],"amount":"300.00"}]}
        self.post("funding-plans",body,code=400)
        quote = self.post("fx-quotes",{"source_currency":"EUR","rate":"35",
            "expires_at":(timezone.now()+timedelta(hours=1)).isoformat()})
        body["allocations"][0]["fx_quote_id"] = quote["id"]
        self.post("funding-plans",body,code=400)
        FXQuote.objects.filter(pk=quote["id"]).update(source_currency="USD",expires_at=timezone.now()-timedelta(seconds=1))
        self.post("funding-plans",body,code=400)

    def test_expense_fx_includes_fees(self):
        quote = self.post("fx-quotes",{"source_currency":"USD","rate":"35",
            "sender_fee":"1","receiver_fee":"5","expires_at":(timezone.now()+timedelta(hours=1)).isoformat()})
        scenario = self.scenario(overrides=[{"event_id":"tuition","amount":"1000",
            "currency":"USD","certainty":"confirmed","fx_quote_id":quote["id"]}])
        self.assertEqual(scenario["result"]["snapshot"]["events"][1]["amount"],"35040.00")

    def test_overallocation_duplicates_opening_and_late_funding(self):
        source = self.source()
        scenario = self.scenario()
        for allocations in [
            [{"source_id":source["id"],"amount":"9001"}],
            [{"source_id":source["id"],"amount":"4000"},{"source_id":source["id"],"amount":"4000"}],
        ]: self.post("funding-plans",{"scenario_id":scenario["id"],"allocations":allocations},code=400)
        opening = self.source(already_in_opening=True)
        self.post("funding-plans",{"scenario_id":scenario["id"],
            "allocations":[{"source_id":opening["id"],"amount":"9000"}]},code=400)
        late = self.source(available_on="2026-10-16")
        result = self.plan([{"source_id":late["id"],"amount":"9000"}])
        self.assertEqual(result["result"]["maximum_reserve_gap"],"9000.00")

    def test_missing_and_estimated_inputs(self):
        override = [{"event_id":"tuition","amount":None,"currency":"THB","certainty":"missing"}]
        self.assertEqual(self.scenario(overrides=override)["result"]["status"],"incomplete")
        source = self.source(certainty="estimated")
        scenario = self.scenario(include=True)
        plan = self.post("funding-plans",{"scenario_id":scenario["id"],
            "allocations":[{"source_id":source["id"],"amount":"9000"}]})
        self.assertEqual(plan["result"]["feasibility"],"feasible_under_assumptions")

    def test_unaffordable_loan_is_not_reported_as_feasible(self):
        loan = self.post("loans",{**LOAN,"monthly_income":"100",
            "monthly_essential_expenses":"99","income_confirmed":True})
        source = self.source(economic_key="unaffordable-loan",kind="loan",
            amount="9000.00",certainty="estimated",loan_id=loan["id"])
        scenario = self.scenario(include=True)
        plan = self.post("funding-plans",{"scenario_id":scenario["id"],
            "allocations":[{"source_id":source["id"],"amount":"9000"}]})
        self.assertEqual(plan["result"]["feasibility"],"unaffordable")
        self.assertEqual(plan["result"]["unaffordable_loan_ids"],[loan["id"]])

    def test_loan_schedule_and_insufficient_income(self):
        result = self.post("loans",LOAN)["result"]
        self.assertEqual(result["net_proceeds"],"9000.00")
        self.assertEqual(len(result["schedule"]),12)
        self.assertEqual(result["schedule"][-1]["closing_balance"],"0.00")
        self.assertEqual(result["affordability_status"],"insufficient_information")
        self.assertEqual(sum(Decimal(x["principal"]) for x in result["schedule"]),Decimal("10000"))

    def test_zero_interest_and_month_end(self):
        result = loan_schedule({**LOAN, "annual_rate": "0", "first_due_date": "2027-01-31"})
        self.assertEqual(result["schedule"][1]["due_date"], "2027-02-28")
        self.assertEqual(result["schedule"][2]["due_date"], "2027-03-31")
        self.assertEqual(result["total_interest"], "0.00")
        self.assertEqual(sum(Decimal(row["principal"]) for row in result["schedule"]), Decimal("10000"))

    def test_legacy_grace_and_foreign_currency_are_rejected(self):
        self.post("loans", {**LOAN, "grace_months": 2}, code=400)
        self.post("loans", {**LOAN, "currency": "USD"}, code=400)

    def test_affordability_and_comparison(self):
        first = self.post("loans", LOAN)
        second = self.post("loans", {**LOAN, "annual_rate": "0"})
        result = self.post("loans/compare", {"loan_ids": [first["id"], second["id"]]})
        self.assertTrue(result["same_net_receipt_basis"])
        self.assertIsNone(result["ranking"])
        self.assertEqual(first["result"]["affordability_status"], "insufficient_information")

    def test_bad_loan_terms_and_no_automatic_affordability(self):
        for changes in [{"fees": "10000"}, {"principal": "0"}, {"annual_rate": "1.01"},
                        {"months": 61}, {"monthly_income": "100000"}]:
            self.post("loans", {**LOAN, **changes}, code=400)
        self.assertEqual(self.post("loans", LOAN)["result"]["affordability_status"], "insufficient_information")

    def test_approval_does_not_credit_balance(self):
        loan,app,disb = self.approved()
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("80000"))
        self.assertEqual(DemoLedgerEntry.objects.count(),0)
        self.assertIsNone(disb)
        self.assertEqual(Disbursement.objects.count(), 0)

    def test_operator_only_and_transitions(self):
        loan = self.post("loans",LOAN)
        app = self.post("applications",{"quote_id":loan["id"]})
        self.post("applications/"+app["id"]+"/decision",{"action":"approve","reason":"LLM says yes"},code=403)
        self.post("applications/"+app["id"]+"/decision",{"action":"approve","reason":"Too early"},operator=True,code=400)
        self.assertEqual(SimulatedApplication.objects.get(pk=app["id"]).status,"DRAFT")

    def test_disbursement_once_and_schedule_in_state(self):
        loan,app,disb = self.receive_loan()
        self.post("applications/"+app["id"]+"/disburse",{"expected_version":app["version"]},operator=True,key="disburse-once",code=200)
        self.assertEqual(DemoLedgerEntry.objects.filter(disbursement=disb).count(),1)
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("89000"))
        state = FinancialState.objects.filter(owner=self.user).first()
        self.assertEqual(sum(e["id"].startswith("repayment:") for e in state.snapshot["events"]),12)

    def test_expired_quote_cannot_disburse(self):
        _, app, _ = self.approved()
        self.post("demo/clock", {"date": "2026-11-02"})
        self.post("applications/" + app["id"] + "/disburse",
                  {"expected_version": app["version"]}, operator=True, code=400)
        self.assertEqual(DemoLedgerEntry.objects.count(), 0)

    def test_full_chain_and_duplicate_payment(self):
        self.receive_loan()
        for event_id in ["rent","tuition"]:
            payment = self.payment(event_id)
            self.authorize(payment)
            self.post("payments/"+payment["id"]+"/submit")
            self.post("payments/"+payment["id"]+"/adapter-event",{"outcome":"settled"},operator=True)
            self.post("payments/"+payment["id"]+"/adapter-event",{"outcome":"settled"},operator=True)
            self.post("payments/"+payment["id"]+"/reconcile")
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("15000"))
        self.assertEqual(DemoLedgerEntry.objects.count(),3)
        self.assertEqual(self.scenario()["result"]["maximum_reserve_gap"],"0.00")
        self.assertEqual(Payment.objects.filter(status="reconciled").count(),2)
        beneficiary = self.beneficiary()
        plan = self.plan()
        self.post("payments",{"plan_id":plan["id"],"beneficiary_id":beneficiary["id"],"event_id":"tuition"},code=400)

    def test_unknown_holds_and_failure_releases(self):
        self.receive_loan()
        payment = self.payment()
        self.authorize(payment)
        self.post("payments/"+payment["id"]+"/submit")
        self.post("payments/"+payment["id"]+"/adapter-event",{"outcome":"unknown"},operator=True)
        response = self.client.get("/api/v2/demo/wallets/")
        self.assertEqual(response.data["results"][0]["available_balance"],"24000.00")
        self.post("payments/"+payment["id"]+"/cancel",code=400)
        self.post("payments/"+payment["id"]+"/adapter-event",{"outcome":"failed"},operator=True)
        response = self.client.get("/api/v2/demo/wallets/")
        self.assertEqual(response.data["results"][0]["available_balance"],"89000.00")

    def test_stale_authorization_and_expiry(self):
        self.receive_loan()
        payment = self.payment()
        self.authorize(payment)
        Payment.objects.filter(pk=payment["id"]).update(authorized_until=timezone.now()-timedelta(seconds=1))
        self.post("payments/"+payment["id"]+"/submit",code=400)
        Payment.objects.filter(pk=payment["id"]).update(authorized_until=timezone.now()+timedelta(minutes=5))
        state = FinancialState.objects.filter(owner=self.user).first()
        FinancialState.objects.create(owner=self.user,version=state.version+1,snapshot=state.snapshot)
        self.post("payments/"+payment["id"]+"/submit",code=409)

    def test_unsettled_promises_cannot_pay(self):
        source = self.source(available_on="2026-10-02")
        beneficiary = self.beneficiary()
        plan = self.plan([{"source_id":source["id"],"amount":"9000"}])
        rent = self.post("payments",{"plan_id":plan["id"],"beneficiary_id":beneficiary["id"],"event_id":"rent"})
        tuition = self.post("payments",{"plan_id":plan["id"],"beneficiary_id":beneficiary["id"],"event_id":"tuition"})
        self.authorize(rent); self.authorize(tuition)
        self.post("payments/"+rent["id"]+"/submit")
        self.post("payments/"+tuition["id"]+"/submit",code=400)

    def test_revocation_and_beneficiary_recheck(self):
        self.receive_loan()
        payment = self.payment()
        self.authorize(payment)
        self.post("beneficiaries/"+str(payment["beneficiary"])+"/verify",{"verified":False},operator=True)
        self.post("payments/"+payment["id"]+"/submit",code=400)
        self.post("payments/"+payment["id"]+"/cancel")
        self.post("payments/"+payment["id"]+"/submit",code=400)

    def test_external_funding_received_once(self):
        source = self.source()
        self.post("funding-sources/"+source["id"]+"/receive",operator=True)
        self.post("funding-sources/"+source["id"]+"/receive",operator=True)
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("89000"))
        self.assertEqual(DemoLedgerEntry.objects.count(),1)
        scenario = self.scenario()
        self.post("funding-plans",{"scenario_id":scenario["id"],"allocations":[{"source_id":source["id"],"amount":"9000"}]},code=400)

    def test_idempotency_and_unknown_fields(self):
        result = self.post("loans",LOAN,key="loan-once")
        again = self.post("loans",LOAN,key="loan-once",code=200)
        self.assertEqual(result["id"],again["id"])
        self.assertEqual(LoanSimulation.objects.count(),1)
        self.post("loans",{**LOAN,"principal":"20000"},key="loan-once",code=400)
        self.post("loans",{**LOAN,"approved":True},code=400)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post("/api/v2/loans/",LOAN,format="json").status_code,400)

    def test_cross_owner_and_read_only_history(self):
        source = self.source()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/v2/funding-sources/"+source["id"]+"/").status_code,404)
        self.assertEqual(self.client.get("/api/v2/funding-sources/").data["count"],0)
        self.assertEqual(self.client.delete("/api/v2/ledger/").status_code,405)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/v2/state/history/").data["count"],1)

    def test_ledger_records_cannot_be_forged_or_rewritten(self):
        self.receive_loan()
        state = FinancialState.objects.filter(owner=self.user).first()
        for mutate in ["opening","delete","forge"]:
            snapshot = deepcopy(state.snapshot)
            if mutate == "opening": snapshot["opening_balance"]="90000.00"
            elif mutate == "delete": snapshot["events"]=[e for e in snapshot["events"] if not e["id"].startswith("loan:")]
            else: snapshot["events"][0]["settled_sequence"]=99
            response = self.client.post("/api/v2/state/",{"expected_version":state.version,"snapshot":snapshot},format="json")
            self.assertEqual(response.status_code,400)

    def test_reconciliation_requires_settlement(self):
        self.receive_loan()
        payment = self.payment()
        self.post("payments/"+payment["id"]+"/reconcile",code=400)
        self.assertEqual(DemoLedgerEntry.objects.count(),1)

    def test_fx_extreme_values_and_calendar_overflow_rejected(self):
        quote = self.post("fx-quotes",{"source_currency":"USD","rate":"99999999999999",
            "expires_at":(timezone.now()+timedelta(hours=1)).isoformat()})
        source = self.source(currency="USD",amount="99999999999999.99")
        scenario = self.scenario()
        self.post("funding-plans",{"scenario_id":scenario["id"],"allocations":[{
            "source_id":source["id"],"amount":"99999999999999.99","fx_quote_id":quote["id"]}]},code=400)
        quote = self.post("fx-quotes",{"source_currency":"USD","rate":"35","settlement_days":1,
            "expires_at":(timezone.now()+timedelta(hours=1)).isoformat()})
        source = self.source(currency="USD",amount="300",available_on="9999-12-31")
        self.post("funding-plans",{"scenario_id":scenario["id"],"allocations":[{
            "source_id":source["id"],"amount":"300","fx_quote_id":quote["id"]}]},code=400)

    def test_jpy_zero_default_fee_and_whole_units(self):
        quote = self.post("fx-quotes",{"source_currency":"JPY","rate":"0.24",
            "expires_at":(timezone.now()+timedelta(hours=1)).isoformat()})
        self.assertEqual(Decimal(quote["sender_fee"]),Decimal("0"))
        self.post("funding-sources",{"economic_key":"fractional-yen","kind":"family",
            "currency":"JPY","amount":"100.50","available_on":"2026-10-02","certainty":"confirmed"},code=400)

    def test_payment_rejects_wrong_verified_beneficiary(self):
        self.receive_loan()
        expected = self.beneficiary()
        wrong = self.post("beneficiaries",{"name":"Wrong recipient","destination_label":"WRONG"})
        self.post("beneficiaries/"+wrong["id"]+"/verify",{"verified":True},operator=True)
        plan = self.plan()
        self.post("payments",{"plan_id":plan["id"],"beneficiary_id":wrong["id"],"event_id":"tuition"},code=400)

    def test_payment_rejects_scenario_amount_that_differs_from_expense(self):
        beneficiary = self.beneficiary()
        scenario = self.scenario(overrides=[{"event_id":"tuition","amount":"56000",
            "currency":"THB","certainty":"confirmed"}])
        self.assertEqual(scenario["result"]["maximum_reserve_gap"],"0.00")
        plan = self.post("funding-plans",{"scenario_id":scenario["id"],"allocations":[]})
        self.assertEqual(plan["result"]["feasibility"],"feasible")
        self.post("payments",{"plan_id":plan["id"],"beneficiary_id":beneficiary["id"],
            "event_id":"tuition"},code=400)

    def test_get_state_round_trip_keeps_ledger_events(self):
        self.receive_loan()
        state = self.client.get("/api/v2/state/").data
        response = self.client.post("/api/v2/state/",{
            "expected_version":state["version"],"snapshot":state["snapshot"]},format="json")
        self.assertEqual(response.status_code,201,str(response.data))

    def test_unknown_fees_are_not_defaulted_to_zero(self):
        payload = {"source_currency":"USD","rate":"35",
            "expires_at":(timezone.now()+timedelta(hours=1)).isoformat()}
        response = self.client.post("/api/v2/fx-quotes/",payload,format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code,400)
        payload = dict(LOAN)
        payload.pop("fees")
        self.post("loans",payload,code=400)
