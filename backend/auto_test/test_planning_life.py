from datetime import date
from uuid import uuid4

from django.contrib.auth import get_user_model
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
        self.assertEqual([i["stage"] for i in data["upcoming"]], ["overdue", "overdue", "due"])
        self.assertEqual(data["attention_count"], 5)
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
        self.plan.status = "ENROLLED"
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

    def test_budget_is_separate_from_money_and_expense_can_be_undone(self):
        self.plan.status = "ENROLLED"
        self.plan.snapshot = {"currency": "THB", "lines": []}
        self.plan.save()
        self.assertFalse(self.read()["budget"]["budget_known"])
        month = services.today_for(self.user).strftime("%Y-%m")
        body = {"month": month, "amount": "6000.00", "expected_version": 0}
        self.assertEqual(self.post("budget/", body).status_code, 201)
        self.assertEqual(self.post("budget/", body).status_code, 409)
        response = self.client.post("/api/v2/planning/expenses/record/", {"amount": "120", "note": "Lunch"},
            format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code, 201, response.data)
        expense = response.data["data"]["expense"]
        budget = self.read()["budget"]
        self.assertEqual(budget["remaining"], "5880.00")
        self.assertEqual(self.post("undo-expense/", {"expense_id": expense["id"]}).status_code, 201)
        self.assertEqual(self.read()["budget"]["remaining"], "6000.00")
        from finance.workflow_models import DemoWallet
        self.assertFalse(DemoWallet.objects.filter(owner=self.user).exists())

    def test_partial_budget_stays_unknown_and_zero_budget_is_valid(self):
        self.plan.status = "ENROLLED"
        self.plan.snapshot = {"currency": "THB", "lines": [
            {"period": "month", "amount": "3000"}, {"period": "month", "amount": None}]}
        self.plan.save()
        self.assertFalse(self.read()["budget"]["budget_known"])
        month = services.today_for(self.user).strftime("%Y-%m")
        self.post("budget/", {"month": month, "amount": "0", "expected_version": 0})
        self.client.post("/api/v2/planning/expenses/record/", {"amount": "120", "note": "Lunch"},
            format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        budget = self.read()["budget"]
        self.assertTrue(budget["budget_known"])
        self.assertTrue(budget["over_budget"])
        self.assertEqual(budget["remaining"], "-120.00")


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
        services.enroll(self.user, services.plan_for(self.user))
        self.assertEqual(StudyTask.objects.filter(plan=self.plan).exclude(template_key="").count(), count)
        self.assertTrue(StudyTask.objects.get(plan=self.plan, template_key="registration").done)

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

    def test_without_wallet_the_forecast_gap_date_marks_later_payments(self):
        from finance.planning.life import money_check
        rows = [{"source_key": "bill:a", "done": False, "amount": "10.00", "currency": "THB", "due_date": "2027-08-01"},
                {"source_key": "bill:b", "done": False, "amount": "10.00", "currency": "THB", "due_date": "2027-09-01"},
                {"source_key": "task:c", "done": False, "amount": None, "currency": "THB", "due_date": "2027-09-01"}]
        money_check(rows, None, {"first_gap_date": "2027-08-20"})
        self.assertEqual([r["at_risk"] for r in rows], [False, True, False])
        self.assertEqual([r["shortfall_basis"] for r in rows], ["forecast", "forecast", None])
