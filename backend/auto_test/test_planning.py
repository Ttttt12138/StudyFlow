"""Agent-first planning: catalog, estimates, conversations, plan states and family links.

The conversation tests drive the real /api/v2/ routes with the deterministic rule planner
(studyflow_ai.agent.planning_rules), so they run offline like the compose demo.
"""
import json
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase
from studyflow_ai.agent import AgentPlanner, RuleAgentProvider

from finance import agent_runner
from finance.agent_models import AgentPendingAction, AgentSession
from finance.agent_tools import CONVERSATION_TOOLS, TOOLS
from finance.planning import catalog, services
from finance.planning.models import FamilyLink, StudyPlan

API = "/api/v2/"
SCHOOL = "chulalongkorn"


def rules_planner():
    return AgentPlanner(RuleAgentProvider())


class CatalogTests(APITestCase):
    def test_every_catalog_file_validates_and_covers_essentials(self):
        entries = catalog.schools()
        self.assertGreaterEqual(len(entries), 3)
        for entry in entries:
            self.assertTrue(entry.sample)
            self.assertTrue(set(catalog.ESSENTIAL) <= {c.category for c in entry.costs}, entry.key)
            for cost in entry.costs:
                if not cost.estimate:
                    self.assertTrue(cost.source_url and cost.quote, (entry.key, cost.cost_id))

    def test_estimate_counts_one_off_costs_once_and_recurring_costs_every_year(self):
        entry = catalog.school(SCHOOL)
        one, two = services.estimate(entry, 1), services.estimate(entry, 2)
        once = sum(Decimal(l["total"]) for l in one["lines"] if l["period"] == "once")
        recurring = Decimal(one["total"]) - once
        self.assertEqual(Decimal(two["total"]), once + 2 * recurring)
        self.assertEqual(Decimal(one["first_year"]), Decimal(one["total"]))
        self.assertLessEqual(Decimal(one["total_low"]), Decimal(one["total"]))
        self.assertLessEqual(Decimal(one["total"]), Decimal(one["total_high"]))
        self.assertEqual(sum(Decimal(v) for v in one["groups"].values()), Decimal(one["total"]))

    def test_planner_results_fit_the_result_budget_for_every_school(self):
        from finance.planning import tools

        user = get_user_model().objects.create_user("budget-check", password="planning-pass-7")
        keys = [e.key for e in catalog.schools()]
        results = [tools._schools(user, {}), tools._compare(user, {"school_keys": keys[:4]})]
        results += [tools._profile(user, {"school_key": k}) for k in keys]
        results += [tools._estimate(user, {"school_key": k}) for k in keys]
        for result in results:
            self.assertLessEqual(len(json.dumps(result, ensure_ascii=False)), agent_runner.RESULT_CHARS)

    def test_legacy_agent_sessions_keep_the_finance_tool_catalog(self):
        self.assertNotIn("list_schools", TOOLS)
        self.assertTrue(set(TOOLS) < set(CONVERSATION_TOOLS))
        self.assertEqual(CONVERSATION_TOOLS["confirm_plan"].tier, "T2")
        self.assertEqual(CONVERSATION_TOOLS["save_plan"].tier, "T1")


class ConversationHarness(APITestCase):
    username = "plan-parent"

    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(self.username, password="planning-pass-1")
        self.client.force_authenticate(self.user)
        patcher = patch.object(agent_runner, "planner", rules_planner)
        patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, url, body=None, **headers):
        return self.client.post(API + url, body or {}, format="json",
                                HTTP_IDEMPOTENCY_KEY=str(uuid4()), **headers)

    def start(self, locale="zh"):
        response = self.post("agent/conversations/", {"locale": locale})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["data"]

    def say(self, conversation, text):
        response = self.post(f"agent/conversations/{conversation['id']}/messages/", {"text": text})
        self.assertEqual(response.status_code, 201, response.data)
        turn = response.data["data"]
        self.assertEqual(turn["status"], "COMPLETED", turn)
        return turn

    def cards(self, turn, kind):
        return [c for c in turn["cards"] if c["type"] == kind]

class ConversationTests(ConversationHarness):
    def test_greeting_asks_for_the_role_before_anything_else(self):
        conversation = self.start()
        self.assertEqual(len(conversation["turns"]), 1)
        self.assertEqual(conversation["turns"][0]["kind"], "assistant")
        self.assertIn("家长", conversation["turns"][0]["final_answer"])
        turn = self.say(conversation, "朱拉隆功贵吗")
        self.assertFalse(turn["steps"][0].get("tool"))
        self.assertIn("家长", turn["final_answer"])

    def test_parent_journey_from_role_to_confirmed_plan(self):
        conversation = self.start()
        turn = self.say(conversation, "我是家长，想了解留学费用")
        self.assertEqual(services.profile(self.user).role, "parent")
        self.assertTrue(self.cards(turn, "school_list"))

        turn = self.say(conversation, "朱拉隆功读4年全部费用多少？")
        cost = self.cards(turn, "cost")[0]["estimate"]
        self.assertEqual(cost["years"], 4)
        self.assertTrue(cost["lines"])
        self.assertIn(cost["converted"]["currency"], ("CNY",))
        self.assertIn("示例数据", turn["final_answer"])

        turn = self.say(conversation, "我们有存款20万人民币，就选朱拉隆功")
        plan = self.cards(turn, "plan")[0]["plan"]
        self.assertEqual((plan["school_key"], plan["status"], plan["funds_currency"], plan["years"]),
                         (SCHOOL, "DRAFT", "CNY", 4))
        self.assertGreater(Decimal(plan["gap"]), 0)

        turn = self.say(conversation, "帮我试算一下贷款，分48个月")
        loan = self.cards(turn, "loan")[0]["plan"]["loan"]
        self.assertEqual((loan["currency"], loan["months"]), ("THB", 48))
        self.assertIn("模拟", turn["final_answer"])

        turn = self.say(conversation, "确认计划")
        confirmation = self.cards(turn, "confirmation")[0]
        self.assertEqual(confirmation["action"], "plan.confirm")
        self.assertEqual(StudyPlan.objects.get(owner=self.user).status, "DRAFT")
        response = self.post(f"agent/pending-actions/{confirmation['pending_action_id']}/confirm/")
        self.assertEqual(response.status_code, 201, response.data)
        plan = StudyPlan.objects.get(owner=self.user)
        self.assertEqual(plan.status, "CONFIRMED")
        self.assertEqual(plan.snapshot["school_key"], SCHOOL)

        # The planner saw earlier turns and server memory on later turns.
        last = AgentSession.objects.filter(conversation_id=conversation["id"]).exclude(goal="").order_by("-created_at").first()
        self.assertEqual(last.cards[0]["type"], "confirmation")

    def test_student_sees_campus_life_first(self):
        conversation = self.start("en")
        self.say(conversation, "I'm a student")
        turn = self.say(conversation, "Tell me about Chulalongkorn")
        school = self.cards(turn, "school")[0]["school"]
        self.assertEqual(school["key"], SCHOOL)
        self.assertTrue(school["food"] and school["attractions"] and school["facilities"])
        self.assertFalse(self.cards(turn, "cost"))

    def test_agent_proposes_enrollment_from_three_days_before_start(self):
        services.set_role(self.user, {"role": "student"})
        services.save_plan(self.user, {"school_key": SCHOOL, "available_funds": "0", "funds_currency": "THB"})
        plan = StudyPlan.objects.get(owner=self.user)
        services.confirm_plan(self.user, plan)
        early = plan.start_date - timedelta(days=4)
        with patch.object(services, "today_for", return_value=early):
            conversation = self.start()
        self.assertFalse(AgentPendingAction.objects.filter(owner=self.user, action="plan.enroll").exists())
        with patch.object(services, "today_for", return_value=plan.start_date - timedelta(days=3)):
            response = self.post(f"agent/conversations/{conversation['id']}/open/")
            self.post(f"agent/conversations/{conversation['id']}/open/")  # proposes once
        turns = response.data["data"]["turns"]
        self.assertIn("3 天", turns[-1]["final_answer"])
        pending = AgentPendingAction.objects.get(owner=self.user, action="plan.enroll", status="PENDING")
        self.assertIsNone(pending.amount)
        response = self.post(f"agent/pending-actions/{pending.id}/confirm/")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(StudyPlan.objects.get(owner=self.user).status, "ENROLLED")
        # An enrolled plan cannot be re-planned through the agent.
        with self.assertRaises(Exception):
            services.save_plan(self.user, {"school_key": SCHOOL})

    def test_confirmations_append_one_persistent_stage_handoff(self):
        services.set_role(self.user, {"role": "student"})
        services.save_plan(self.user, {"school_key": SCHOOL})
        conversation = self.start("en")
        for text, expected in [("Confirm the plan", "preparing for enrollment"),
                               ("I have completed registration", "daily life")]:
            turn = self.say(conversation, text)
            pending_id = self.cards(turn, "confirmation")[0]["pending_action_id"]
            url = f"agent/pending-actions/{pending_id}/confirm/"
            self.assertEqual(self.post(url).status_code, 201)
            self.assertIn(self.post(url).status_code, (200, 201))
            rows = AgentSession.objects.filter(conversation_id=conversation["id"], goal="",
                                                final_answer__contains=expected)
            self.assertEqual(rows.count(), 1)
        current = self.client.get(API + f"agent/conversations/{conversation['id']}/").data["data"]
        self.assertEqual(current["plan"]["status"], "ENROLLED")
        self.assertIn("daily life", current["turns"][-1]["final_answer"])

    def test_not_ready_keeps_confirmed_plan_and_no_bills(self):
        services.set_role(self.user, {"role": "student"})
        services.save_plan(self.user, {"school_key": SCHOOL})
        services.confirm_plan(self.user, StudyPlan.objects.get(owner=self.user))
        conversation = self.start()
        turn = self.say(conversation, "还没报到，还在准备")
        self.assertFalse(self.cards(turn, "confirmation"))
        self.assertEqual(StudyPlan.objects.get(owner=self.user).status, "CONFIRMED")
        self.assertFalse(self.client.get(API + "planning/in-school/").data["data"]["enrolled"])

    def test_other_users_cannot_read_a_conversation(self):
        conversation = self.start()
        other = get_user_model().objects.create_user("plan-other", password="planning-pass-2")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(API + f"agent/conversations/{conversation['id']}/").status_code, 404)

    def test_message_replay_returns_the_stored_turn(self):
        conversation = self.start()
        url = API + f"agent/conversations/{conversation['id']}/messages/"
        first = self.client.post(url, {"text": "我是家长"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        again = self.client.post(url, {"text": "我是家长"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.data["data"]["id"], again.data["data"]["id"])
        clash = self.client.post(url, {"text": "我是学生"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        self.assertEqual(clash.status_code, 400)


class FamilyLinkTests(APITestCase):
    def setUp(self):
        cache.clear()
        users = get_user_model().objects
        self.student = users.create_user("link-student", password="planning-pass-3")
        self.parent = users.create_user("link-parent", password="planning-pass-4")
        self.operator = users.create_user("link-operator", password="planning-pass-5", is_staff=True)

    def token(self):
        self.client.force_authenticate(self.student)
        created = self.client.post(API + "sponsor-requests/", {
            "economic_key": "family-2027", "currency": "CNY", "amount": "50000.00",
            "available_on": "2027-07-01", "purpose": "Tuition support"},
            format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(created.status_code, 201, created.data)
        item = created.data["data"]
        self.client.force_authenticate(self.operator)
        issued = self.client.post(API + f"sponsor-requests/{item['id']}/issue-link/",
                                  {"terms_version": item["terms_version"]}, format="json",
                                  HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(issued.status_code, 201, issued.data)
        return issued.data["data"]["token"], item["terms_version"]

    def test_parent_links_after_confirming_the_sponsor_link(self):
        token, version = self.token()
        self.client.force_authenticate(self.parent)
        early = self.client.post(API + "planning/family-links/", HTTP_X_SPONSOR_TOKEN=token)
        self.assertEqual(early.status_code, 400)
        self.client.force_authenticate(None)
        confirmed = self.client.post(API + "sponsor-confirmation/", {"decision": "confirm", "terms_version": version},
                                     format="json", HTTP_X_SPONSOR_TOKEN=token, HTTP_IDEMPOTENCY_KEY="c-1")
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.client.force_authenticate(self.parent)
        linked = self.client.post(API + "planning/family-links/", HTTP_X_SPONSOR_TOKEN=token)
        self.assertEqual(linked.status_code, 201, linked.data)
        self.assertEqual(linked.data["data"]["relation"], "child")
        self.assertEqual(services.profile(self.parent).role, "parent")
        self.client.post(API + "planning/family-links/", HTTP_X_SPONSOR_TOKEN=token)
        self.assertEqual(FamilyLink.objects.count(), 1)
        self.client.force_authenticate(self.student)
        own = self.client.post(API + "planning/family-links/", HTTP_X_SPONSOR_TOKEN=token)
        self.assertEqual(own.status_code, 400)
        mine = self.client.get(API + "planning/family-links/")
        self.assertEqual(mine.data["data"][0]["relation"], "parent")


class InSchoolTests(ConversationHarness):
    username = "plan-student"

    def enroll(self, with_loan=True):
        services.set_role(self.user, {"role": "student"})
        services.save_plan(self.user, {"school_key": SCHOOL, "available_funds": "100000", "funds_currency": "THB"})
        if with_loan:
            services.simulate_loan(self.user, {"months": 12})
        plan = StudyPlan.objects.get(owner=self.user)
        services.confirm_plan(self.user, plan)
        services.enroll(self.user, StudyPlan.objects.get(owner=self.user))
        return StudyPlan.objects.get(owner=self.user)

    def test_enrollment_generates_tuition_and_loan_bills(self):
        plan = self.enroll()
        kinds = {b.kind for b in plan.bills.all()}
        self.assertTrue({"tuition", "loan"} <= kinds, kinds)
        self.assertEqual(plan.bills.filter(kind="loan").count(), 12)
        tuition = plan.bills.filter(kind="tuition", source_id__contains="y1s").count()
        self.assertEqual(tuition, catalog.school(SCHOOL).calendar.semesters_per_year)
        # Regenerating never duplicates bills.
        from finance.planning.in_school import generate_bills
        self.assertEqual(generate_bills(self.user, plan), 0)
        response = self.client.get(API + "planning/in-school/")
        self.assertTrue(response.data["data"]["enrolled"])
        bill = response.data["data"]["upcoming_bills"][0]
        paid = self.post(f"planning/bills/{bill['id']}/pay/")
        self.assertEqual((paid.status_code, paid.data["data"]["status"]), (201, "PAID"))
        self.assertEqual(self.post(f"planning/bills/{bill['id']}/pay/").status_code, 400)

    def test_agent_records_spending_and_reports_the_month(self):
        self.enroll(with_loan=False)
        conversation = self.start()
        turn = self.say(conversation, "今天午饭花了120泰铢")
        card = self.cards(turn, "spending")[0]
        self.assertEqual((card["expense"]["category"], card["expense"]["amount"]), ("food", "120.00"))
        self.assertIn("已记下", turn["final_answer"])
        turn = self.say(conversation, "这个月花了多少？")
        self.assertEqual(self.cards(turn, "spending")[0]["spent"], "120.00")
        turn = self.say(conversation, "接下来有哪些账单")
        self.assertTrue(self.cards(turn, "bills")[0]["bills"])

    def test_spending_needs_enrollment_and_form_entry_works(self):
        blocked = self.post("planning/expenses/record/", {"amount": "50.00", "note": "taxi"})
        self.assertEqual(blocked.status_code, 400)
        self.enroll(with_loan=False)
        made = self.post("planning/expenses/record/", {"amount": "50.00", "note": "taxi", "currency": "THB"})
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(made.data["data"]["expense"]["category"], "transport")
        self.assertFalse(made.data["data"]["expense"]["via_agent"])

    def test_monthly_expense_pages_cover_all_rows_and_isolate_owner_and_month(self):
        self.enroll(with_loan=False)
        from finance.planning.models import ExpenseEntry
        for i in range(53):
            ExpenseEntry.objects.create(owner=self.user, spent_on="2026-10-12", amount="2.00",
                                        currency="THB", category="food", note=f"Lunch {i}")
        ExpenseEntry.objects.create(owner=self.user, spent_on="2026-09-12", amount="999.00",
                                    currency="THB", category="food")
        other = get_user_model().objects.create_user("other-spending-owner")
        ExpenseEntry.objects.create(owner=other, spent_on="2026-10-12", amount="999.00",
                                    currency="THB", category="food")
        first = self.client.get(API + "planning/expenses/?month=2026-10").data["data"]
        second = self.client.get(API + "planning/expenses/?month=2026-10&offset=50").data["data"]
        self.assertEqual((first["count"], first["spent"], first["next_offset"]), (53, "106.00", 50))
        self.assertEqual((len(first["entries"]), len(second["entries"]), second["next_offset"]), (50, 3, None))
        self.assertEqual(len({e["id"] for e in first["entries"] + second["entries"]}), 53)
        self.assertEqual(self.client.get(API + "planning/expenses/?offset=-1").status_code, 400)
        empty = self.client.get(API + "planning/expenses/?month=2026-08").data["data"]
        self.assertEqual((empty["entries"], empty["count"]), ([], 0))

    def test_finance_requests_still_reach_the_wallet_tools(self):
        services.set_role(self.user, {"role": "student"})
        conversation = self.start()
        turn = self.say(conversation, "人民币兑泰铢汇率是多少")
        self.assertEqual(turn["steps"][0]["tool"], "get_fx_rate")

    def test_linked_parent_sees_bills_and_totals_but_not_notes(self):
        self.enroll(with_loan=False)
        from finance.planning.in_school import record_expense
        record_expense(self.user, {"amount": "80", "currency": "THB", "note": "secret gift"})
        parent = get_user_model().objects.create_user("plan-parent-2", password="planning-pass-6")
        from finance.sponsorship import SponsorRequest
        from finance.workflow_models import FundingSource
        source = FundingSource.objects.create(owner=self.user, economic_key="k", kind="family", currency="THB",
                                              amount=Decimal("1000"), available_on="2027-01-01", certainty="confirmed")
        request = SponsorRequest.objects.create(owner=self.user, source=source, purpose="p", status="CONFIRMED")
        FamilyLink.objects.create(student=self.user, parent=parent, sponsor_request=request)
        self.client.force_authenticate(parent)
        child = self.client.get(API + "planning/family-links/").data["data"][0]
        self.assertEqual(child["in_school"]["spending"]["spent"], "80.00")
        self.assertNotIn("recent", child["in_school"]["spending"])
        self.assertNotIn("secret", json.dumps(child))
