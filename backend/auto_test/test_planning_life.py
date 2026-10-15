from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from finance.planning import services
from finance.planning.models import PlanBill, StudyTask


class LifeCase(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("life-student")
        self.client.force_authenticate(self.user)
        services.save_plan(self.user, {"school_key": "psu-phuket"})
        self.plan = services.plan_for(self.user)

    def post(self, path, body, key=None):
        return self.client.post("/api/v2/planning/life/" + path, body, format="json",
                                HTTP_IDEMPOTENCY_KEY=key or str(uuid4()))

    def read(self):
        response = self.client.get("/api/v2/planning/life/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["data"]

    def task(self, **patch):
        body = {"title": "Submit housing documents", "due_date": "2027-08-08", **patch}
        result = self.post("tasks/", body)
        self.assertEqual(result.status_code, 201, result.data)
        return result.data["data"]

    def act(self, item, action, **patch):
        return self.post("actions/", {"source_key": item["source_key"], "expected_token": item["token"],
                                      "action": action, **patch})


class PlanningLifeTests(LifeCase):
    def test_stage_boundaries(self):
        from finance.planning.life import reminder_stage
        for day, stage in [("2027-07-31", "later"), ("2027-08-01", "week"),
                           ("2027-08-07", "tomorrow"), ("2027-08-08", "due"), ("2027-08-09", "overdue")]:
            self.assertEqual(reminder_stage(date(2027, 8, 8), date.fromisoformat(day)), stage)
        self.assertEqual(reminder_stage(None, date(2027, 8, 8)), "unknown")

    def test_clock_reopens_new_stage_and_snooze_expires_without_duplicates(self):
        self.assertEqual(self.post("clock/", {"date": "2027-08-01"}).status_code, 201)
        self.task()
        item = self.read()["items"][0]
        self.act(item, "acknowledge")
        self.assertFalse(self.read()["items"][0]["unread"])
        self.post("clock/", {"date": "2027-08-02"})
        self.assertFalse(self.read()["items"][0]["unread"])
        self.post("clock/", {"date": "2027-08-07"})
        item = self.read()["items"][0]
        self.assertTrue(item["unread"])
        self.assertEqual(item["stage"], "tomorrow")
        self.act(item, "snooze", date="2027-08-08")
        self.assertEqual(self.read()["upcoming"], [])
        self.post("clock/", {"date": "2027-08-08"})
        self.assertEqual(len(self.read()["upcoming"]), 1)
        self.assertEqual(self.read()["upcoming"][0]["stage"], "due")
        self.assertEqual(self.post("clock/", {"date": "2027-08-07"}).status_code, 400)
        from finance.workflow_models import DemoWallet
        self.assertFalse(DemoWallet.objects.filter(owner=self.user).exists())

    def test_prioritizes_three_items_and_does_not_enroll_automatically(self):
        self.plan.status = "CONFIRMED"
        self.plan.start_date = date(2027, 8, 1)
        self.plan.save()
        self.post("clock/", {"date": "2027-08-08"})
        for day in (None, "2027-08-07", "2027-08-08", "2027-08-09", "2027-08-20"):
            self.task(due_date=day)
        data = self.read()
        self.assertEqual([i["stage"] for i in data["upcoming"]], ["overdue", "due", "tomorrow"])
        self.assertEqual(data["attention_count"], 4)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.status, "CONFIRMED")

    def test_new_wallet_preserves_advanced_planning_date(self):
        from finance import execution_services
        from finance.services import save_state
        self.post("clock/", {"date": "2027-08-08"})
        state = save_state(self.user, 0, {"currency": "THB", "as_of": "2027-08-01",
            "opening_balance": "0.00", "reserve": "0.00", "events": []})
        execution_services.initialize(self.user, {"state_version": state.version})
        self.assertEqual(self.read()["today"], "2027-08-08")
        self.post("clock/", {"date": "2027-08-09"})
        self.assertEqual(self.read()["today"], "2027-08-09")

    def test_task_retries_and_read_are_idempotent(self):
        key = str(uuid4())
        body = {"title": "Bring passport", "due_date": None}
        a = self.post("tasks/", body, key)
        b = self.post("tasks/", body, key)
        self.assertEqual(a.data, b.data)
        self.assertEqual(StudyTask.objects.filter(owner=self.user).count(), 1)
        first = self.read()
        self.assertEqual(first, self.read())
        self.assertEqual(first["items"][0]["stage"], "unknown")

    def test_acknowledge_is_not_completion_and_reschedule_reopens_badge(self):
        self.task()
        item = self.read()["items"][0]
        self.assertEqual(self.act(item, "acknowledge").status_code, 201)
        item = self.read()["items"][0]
        self.assertFalse(item["unread"])
        self.assertFalse(item["done"])
        self.assertEqual(self.act(item, "reschedule", date="2027-08-10").status_code, 201)
        changed = self.read()["items"][0]
        self.assertTrue(changed["unread"])
        self.assertEqual(changed["due_date"], "2027-08-10")
        self.assertEqual(self.act(item, "complete").status_code, 409)

    def test_snooze_does_not_change_deadline_and_completion_survives_reload(self):
        self.task()
        item = self.read()["items"][0]
        self.assertEqual(self.act(item, "snooze", date="2090-01-01").status_code, 201)
        item = self.read()["items"][0]
        self.assertTrue(item["snoozed"])
        self.assertEqual(item["due_date"], "2027-08-08")
        self.assertEqual(self.act(item, "complete").status_code, 201)
        self.assertTrue(self.read()["items"][0]["done"])

    def test_foreign_task_and_stale_token_are_rejected(self):
        self.task()
        item = self.read()["items"][0]
        other = get_user_model().objects.create_user("life-other")
        self.client.force_authenticate(other)
        self.assertEqual(self.act(item, "complete").status_code, 400)
        self.client.force_authenticate(self.user)
        item["token"] = "old"
        self.assertEqual(self.act(item, "complete").status_code, 409)

    def test_estimated_bills_are_not_official_deadlines(self):
        self.plan.status = "CONFIRMED"
        self.plan.snapshot = {"currency": "THB", "lines": []}
        self.plan.save()
        bill = PlanBill.objects.create(owner=self.user, plan=self.plan, kind="tuition", source_id="sample",
            label={"en": "Tuition", "zh": "学费"}, due_date=date(2027, 8, 8), amount="20000", currency="THB")
        item = next(i for i in self.read()["items"] if i["kind"] == "bill")
        self.assertTrue(item["estimated"])
        self.assertEqual(self.act(item, "reschedule", date="2027-08-10").status_code, 201)
        bill.refresh_from_db()
        self.assertEqual(bill.due_date, date(2027, 8, 8))
        item = next(i for i in self.read()["items"] if i["kind"] == "bill")
        self.assertFalse(item["estimated"])
        self.assertEqual(self.act(item, "complete").status_code, 201)
        bill.refresh_from_db()
        self.assertEqual(bill.status, "PAID")




class PlanningLifeChecklistTests(LifeCase):
    """Bills and the arrival checklist start at confirmation; payments are checked against money on hand."""

    def bill(self, amount, day, source):
        return PlanBill.objects.create(owner=self.user, plan=self.plan, kind="tuition", source_id=source,
            label={"en": "Tuition", "zh": "学费"}, due_date=date.fromisoformat(day), amount=amount, currency="THB")

    def test_confirmation_creates_bills_and_country_checklist_once(self):
        services.confirm_plan(self.user, self.plan)
        self.assertTrue(PlanBill.objects.filter(plan=self.plan, status="DUE").exclude(kind="loan").exists())
        tasks = StudyTask.objects.filter(plan=self.plan).exclude(template_key="")
        self.assertIn("report90", set(tasks.values_list("template_key", flat=True)))  # Thailand
        self.assertTrue(all(t.amount is None for t in tasks))  # costs arrive as bills, never twice
        item = next(i for i in self.read()["items"] if i["kind"] == "task")
        self.assertTrue(item["template"])
        self.assertEqual(set(item["title"]), {"en", "zh"})
        count = tasks.count()
        from finance.planning import checklist
        checklist.seed(self.user, services.plan_for(self.user))
        self.assertEqual(StudyTask.objects.filter(plan=self.plan).exclude(template_key="").count(), count)
        self.assertFalse(StudyTask.objects.get(plan=self.plan, template_key="registration").done)

    def test_reopening_a_plan_drops_open_generated_items_and_keeps_finished_ones(self):
        services.confirm_plan(self.user, self.plan)
        paid = PlanBill.objects.filter(plan=self.plan).exclude(kind="loan").first()
        paid.status = "PAID"
        paid.save()
        done = StudyTask.objects.filter(plan=self.plan, template_key="visa").get()
        done.done = True
        done.save()
        mine = self.task()
        services.save_plan(self.user, {"school_key": "psu-phuket", "years": 2})
        self.assertEqual(list(PlanBill.objects.filter(plan=self.plan)), [paid])
        self.assertEqual(list(StudyTask.objects.filter(plan=self.plan).exclude(template_key="")), [done])
        self.assertTrue(StudyTask.objects.filter(pk=mine["task_id"]).exists())

    def test_actual_amount_replaces_the_estimate_and_can_be_reset(self):
        self.bill("20000", "2027-08-08", "sample")
        item = next(i for i in self.read()["items"] if i["kind"] == "bill")
        self.assertEqual(self.act(item, "set_amount", amount="23500.00").status_code, 201)
        item = next(i for i in self.read()["items"] if i["kind"] == "bill")
        self.assertEqual((item["amount"], item["catalog_amount"]), ("23500.00", "20000.00"))
        self.assertTrue(item["amount_confirmed"])
        self.assertFalse(item["estimated"])
        self.assertEqual(self.act(item, "set_amount").status_code, 400)
        self.assertEqual(self.act(item, "set_amount", amount=None).status_code, 201)
        item = next(i for i in self.read()["items"] if i["kind"] == "bill")
        self.assertEqual(item["amount"], "20000.00")
        self.assertTrue(item["estimated"])

    def test_wallet_covers_bills_in_due_order_without_counting_money_twice(self):
        from finance import execution_services
        from finance.services import save_state
        state = save_state(self.user, 0, {"currency": "THB", "as_of": "2027-08-01",
            "opening_balance": "30000.00", "reserve": "0.00", "events": []})
        execution_services.initialize(self.user, {"state_version": state.version})
        self.bill("20000", "2027-09-01", "late")
        self.bill("20000", "2027-08-15", "early")
        rows = {i["due_date"]: i for i in self.read()["items"] if i["kind"] == "bill"}
        self.assertEqual((rows["2027-08-15"]["shortfall"], rows["2027-08-15"]["at_risk"]), ("0", False))
        self.assertEqual((rows["2027-09-01"]["shortfall"], rows["2027-09-01"]["at_risk"]), ("10000.00", True))
        self.assertEqual(rows["2027-09-01"]["shortfall_basis"], "wallet")

    def test_without_wallet_does_not_infer_a_funding_gap(self):
        from finance.planning.life import money_check
        rows = [{"source_key": "bill:a", "done": False, "amount": "10.00", "currency": "THB", "due_date": "2027-08-01"},
                {"source_key": "bill:b", "done": False, "amount": "10.00", "currency": "THB", "due_date": "2027-09-01"},
                {"source_key": "task:c", "done": False, "amount": None, "currency": "THB", "due_date": "2027-09-01"}]
        money_check(rows, None)
        self.assertEqual([r["at_risk"] for r in rows], [False, False, False])
        self.assertEqual([r["shortfall_basis"] for r in rows], [None, None, None])




class WalletBillPaymentTests(APITestCase):
    """The wallet's pay tab lists the plan's bills and pays them from the demo wallet after a password step-up."""
    PASSWORD = "bill-pay-pass-17"

    def setUp(self):
        from finance.planning.assessment import ensure_demo_state
        from finance.workflow_models import DemoWallet

        cache.clear()
        from finance.policy_models import PolicyLimit
        PolicyLimit.objects.update_or_create(action="outflow", currency="THB", defaults={
            "per_transaction": "50000", "daily": "100000", "monthly": "300000", "enabled": True})
        self.user = get_user_model().objects.create_user("bill-payer", password=self.PASSWORD)
        self.client.force_authenticate(self.user)
        services.save_plan(self.user, {"school_key": "psu-phuket"})
        self.plan = services.plan_for(self.user)
        ensure_demo_state(self.user)
        DemoWallet.objects.filter(owner=self.user).update(balance=Decimal("30000.00"))
        self.bill = PlanBill.objects.create(owner=self.user, plan=self.plan, kind="tuition", source_id="tuition:y1s1",
            label={"en": "Tuition", "zh": "学费"}, due_date=date(2027, 8, 8), amount=Decimal("20000.00"), currency="THB")

    def pay(self, bill, token=None):
        headers = {"HTTP_IDEMPOTENCY_KEY": str(uuid4())}
        if token:
            headers["HTTP_X_STEP_UP_TOKEN"] = token
        return self.client.post(f"/api/v2/planning/bills/{bill.id}/pay-from-wallet/", {}, format="json", **headers)

    def token(self, bill):
        response = self.client.post("/api/v2/auth/step-up/", {"password": self.PASSWORD, "action": "bill.pay",
            "target_id": str(bill.id), "amount": str(bill.amount), "currency": bill.currency}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["token"]

    def test_bills_are_listed_and_paid_from_the_wallet_after_step_up(self):
        from finance.models import FinancialState
        from finance.workflow_models import DemoLedgerEntry, DemoWallet

        listed = self.client.get("/api/v2/planning/wallet-bills/").data["data"]["bills"]
        self.assertEqual([(b["id"], b["status"], b["paid_by_loan"]) for b in listed], [(str(self.bill.id), "DUE", False)])
        self.assertNotEqual(self.pay(self.bill).status_code, 201)
        response = self.pay(self.bill, self.token(self.bill))
        self.assertEqual(response.status_code, 201, response.data)
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, "PAID")
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance, Decimal("10000.00"))
        entry = DemoLedgerEntry.objects.get(plan_bill=self.bill)
        self.assertEqual(entry.amount, Decimal("-20000.00"))
        events = FinancialState.objects.filter(owner=self.user).order_by("-version").first().snapshot["events"]
        self.assertEqual(next(e for e in events if e["id"] == f"bill:{self.bill.id}")["settled_sequence"], entry.sequence)

    def test_tuition_goes_only_to_a_verified_school_account(self):
        from finance.planning.payees import school_payee
        from finance.workflow_models import DemoWallet

        listed = self.client.get("/api/v2/planning/wallet-bills/").data["data"]
        self.assertIsNone(listed["school_payee"])  # a draft plan can still change school
        payee = school_payee(self.plan)
        payee.verified = False
        payee.save(update_fields=["verified"])
        listed = self.client.get("/api/v2/planning/wallet-bills/").data["data"]
        self.assertEqual((listed["school_payee"]["id"], listed["school_payee"]["verified"]), (str(payee.id), False))
        refused = self.pay(self.bill, self.token(self.bill))
        self.assertEqual(refused.status_code, 400, refused.data)
        self.assertIn("SCHOOL_PAYEE_NOT_VERIFIED", str(refused.data))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, "DUE")
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance, Decimal("30000.00"))
        # Bills that are not tuition need not go to the school.
        visa = PlanBill.objects.create(owner=self.user, plan=self.plan, kind="visa", source_id="visa:once",
            label={"en": "Visa", "zh": "签证"}, due_date=date(2027, 8, 8), amount=Decimal("2000.00"), currency="THB")
        self.assertEqual(self.pay(visa, self.token(visa)).status_code, 201)
        payee.verified = True
        payee.save(update_fields=["verified"])
        self.assertEqual(self.pay(self.bill, self.token(self.bill)).status_code, 201)


    def test_short_balance_and_loan_paid_bills_are_refused(self):
        big = PlanBill.objects.create(owner=self.user, plan=self.plan, kind="housing", source_id="housing:y1s1",
            label={"en": "Housing", "zh": "住宿"}, due_date=date(2027, 8, 8), amount=Decimal("40000.00"), currency="THB")
        short = self.pay(big, self.token(big))
        self.assertEqual(short.status_code, 400, short.data)
        from finance.planning.models import LoanPayout
        from finance.workflow_models import LoanSimulation, SimulatedApplication
        loan = LoanSimulation.objects.create(owner=self.user, inputs={}, result={})
        application = SimulatedApplication.objects.create(owner=self.user, loan=loan, status="DISBURSED")
        LoanPayout.objects.create(owner=self.user, plan=self.plan, application=application, bill=self.bill,
                                  amount=self.bill.amount, bill_amount=self.bill.amount, due_date=self.bill.due_date)
        listed = self.client.get("/api/v2/planning/wallet-bills/").data["data"]["bills"]
        self.assertTrue(next(b for b in listed if b["id"] == str(self.bill.id))["paid_by_loan"])
        self.assertEqual(self.pay(self.bill, self.token(self.bill)).status_code, 400)

    def test_loan_paid_bill_needs_nothing_from_the_student(self):
        from finance.planning.models import LoanPayout
        from finance.workflow_models import LoanSimulation, SimulatedApplication
        loan = LoanSimulation.objects.create(owner=self.user, inputs={}, result={})
        application = SimulatedApplication.objects.create(owner=self.user, loan=loan, status="DISBURSED")
        LoanPayout.objects.create(owner=self.user, plan=self.plan, application=application, bill=self.bill,
                                  amount=self.bill.amount, bill_amount=self.bill.amount, due_date=self.bill.due_date)
        items = self.client.get("/api/v2/planning/life/").data["data"]["items"]
        item = next(i for i in items if i["source_key"] == f"bill:{self.bill.id}")
        self.assertEqual(item["paid_by_loan"], "20000.00")
        self.assertIsNone(item["shortfall"])
        for path, body in (("planning/life/actions/", {"action": "complete"}),):
            response = self.client.post("/api/v2/" + path, {"source_key": item["source_key"], "expected_token": item["token"], **body},
                                        format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn("BILL_PAID_BY_LOAN", str(response.data))


class SchoolPayeeSeedTests(APITestCase):
    def test_every_catalog_school_has_a_verified_seeded_account(self):
        from finance.planning import catalog
        from finance.planning.payees import VERIFIED

        self.assertEqual({entry.key for entry in catalog.schools()}, set(VERIFIED))

    def test_switching_school_drops_the_old_account(self):
        from finance.planning.payees import school_payee

        user = get_user_model().objects.create_user("payee-switch")
        services.save_plan(user, {"school_key": "psu-phuket"})
        first = school_payee(services.plan_for(user))
        services.save_plan(user, {"school_key": "malaya"})
        second = school_payee(services.plan_for(user))
        self.assertNotEqual(first.id, second.id)
        self.assertEqual(second.name, "Universiti Malaya (Faculty of Business and Economics)")
