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
from finance.planning.models import StudyPlan

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

    def test_school_list_and_cards_say_where_the_figures_come_from(self):
        from finance.planning import cards, tools

        user = get_user_model().objects.create_user("sources-check", password="planning-pass-8")
        self.client.force_authenticate(user)
        listed = self.client.get(API + "planning/schools/").data["data"]["schools"]
        self.assertEqual(len(listed), len(catalog.schools()))
        for row in listed:
            entry = catalog.school(row["key"])
            self.assertEqual([s["url"] for s in row["sources"]], [str(s.url) for s in entry.sources])
            self.assertTrue(row["observed_at"] and row["website"] and all(s["title"] and s["accessed"] for s in row["sources"]))
        keys = [e.key for e in catalog.schools()]
        listing = cards.build(user, "list_schools", {}, tools._schools(user, {}), "OK")
        self.assertTrue(all(row["sources"] for row in listing["schools"]))
        result = tools._compare(user, {"school_keys": keys[:2]})
        compared = cards.build(user, "compare_schools", {"school_keys": keys[:2]}, result, "OK")
        self.assertTrue(all(row["sources"] for row in compared["schools"]))
        self.assertNotIn("sources", result["schools"][0])  # the planner's own result stays compact

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

    def test_school_brief_and_comparison_carry_full_course_totals(self):
        from finance.planning import tools

        user = get_user_model().objects.create_user("compare-check", password="planning-pass-8")
        entry = catalog.school(SCHOOL)
        brief = services.school_brief(entry, "USD")
        full = services.estimate(entry)
        self.assertEqual((brief["years"], brief["total"], brief["total_low"], brief["total_high"]),
                         (services.default_years(entry), full["total"], full["total_low"], full["total_high"]))
        self.assertEqual(brief["total_converted"]["currency"], "USD")
        self.assertNotIn("total_converted", services.school_brief(entry, entry.school.currency))
        compared = tools._compare(user, {"school_keys": [SCHOOL, "manchester", "melbourne"]})
        self.assertEqual(compared["home_currency"], "THB")
        for row in compared["schools"]:
            self.assertTrue(row["total"] and row["years"], row["key"])
            if row["currency"] != "THB":
                self.assertEqual(row["total_converted"]["currency"], "THB")

        def thb(row):
            return Decimal(row["total"] if row["currency"] == "THB" else row["total_converted"]["amount"])
        self.assertEqual(compared["cheapest"], min(compared["schools"], key=thb)["key"])
        self.assertNotIn("set_role", CONVERSATION_TOOLS)

    def test_legacy_agent_sessions_keep_the_finance_tool_catalog(self):
        self.assertNotIn("list_schools", TOOLS)
        self.assertTrue((set(TOOLS) - {"get_credit_profile"}) < set(CONVERSATION_TOOLS))
        self.assertNotIn("confirm_plan", CONVERSATION_TOOLS)
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

class ProfileTests(ConversationHarness):
    username = "plan-profile"

    def test_profile_defaults_to_thb_and_needs_only_a_display_currency(self):
        data = self.client.get(API + "planning/profile/").data["data"]
        self.assertEqual((data["role"], data["home_currency"]), (None, "THB"))
        response = self.client.post(API + "planning/profile/", {"home_currency": "USD"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"], {"role": None, "home_currency": "USD"})
        self.assertEqual(services.profile(self.user).home_currency, "USD")
        self.assertEqual(self.client.get(API + "planning/profile/").data["data"]["home_currency"], "USD")
        lower = self.client.post(API + "planning/profile/", {"home_currency": "cny"}, format="json")
        self.assertEqual(lower.data["data"]["home_currency"], "CNY")

    def test_other_currencies_are_rejected(self):
        for code in ("GBP", "EUR", "XYZ"):
            response = self.client.post(API + "planning/profile/", {"home_currency": code}, format="json")
            self.assertEqual(response.status_code, 400, code)
            self.assertEqual(response.data["code"], "CURRENCY_NOT_SUPPORTED")
        self.assertIsNone(services.profile(self.user))
        bad_role = self.client.post(API + "planning/profile/", {"role": "teacher"}, format="json")
        self.assertEqual(bad_role.status_code, 400)

    def test_display_rates_cover_display_and_catalog_currencies(self):
        response = self.client.get(API + "planning/rates/")
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual(data["currencies"], ["THB", "CNY", "USD"])
        self.assertTrue(data["is_simulated"])
        wanted = {"THB", "CNY", "USD", *(e.school.currency for e in catalog.schools())}
        self.assertEqual(set(data["thb_per_unit"]), wanted)
        self.assertEqual(data["thb_per_unit"]["THB"], "1")
        for code, rate in data["thb_per_unit"].items():
            self.assertGreater(Decimal(rate), 0, code)
        self.assertTrue(data["rate_date"] and data["source"])

    def test_display_rates_skip_a_currency_without_a_rate(self):
        from finance import fx_rates

        real = fx_rates.get_rate

        def flaky(base, quote):
            if base == "JPY":
                raise fx_rates.FxUnavailable()
            return real(base, quote)

        with patch.object(fx_rates, "get_rate", flaky):
            data = self.client.get(API + "planning/rates/").data["data"]
        self.assertNotIn("JPY", data["thb_per_unit"])
        self.assertIn("USD", data["thb_per_unit"])


class ConversationTests(ConversationHarness):
    def test_greeting_leads_with_price_and_never_asks_for_a_role(self):
        for locale in ("zh", "en"):
            conversation = self.start(locale)
            self.assertEqual(len(conversation["turns"]), 1)
            greeting = conversation["turns"][0]
            self.assertEqual(greeting["kind"], "assistant")
            self.assertNotIn("家长", greeting["final_answer"])
            self.assertNotIn("parent", greeting["final_answer"].lower())
        self.assertIn("总价", self.start("zh")["turns"][0]["final_answer"])
        conversation = self.start()
        turn = self.say(conversation, "朱拉隆功贵吗")
        self.assertEqual(turn["steps"][0]["tool"], "estimate_total_cost")
        self.assertIsNone(services.profile(self.user))

    def test_a_retried_estimate_replaces_the_earlier_cost_card(self):
        from types import SimpleNamespace

        session = SimpleNamespace(conversation_id=uuid4(), owner=self.user, cards=[])
        for years in (3, None):
            agent_runner._add_card(session, "estimate_total_cost", {"school_key": "psu-phuket", "years": years}, {}, "OK")
        agent_runner._add_card(session, "estimate_total_cost", {"school_key": "chulalongkorn"}, {}, "OK")
        self.assertEqual([c["school"]["key"] for c in session.cards], ["psu-phuket", "chulalongkorn"])
        self.assertEqual(session.cards[0]["estimate"]["years"], 3.5)

    def test_choosing_a_school_shows_its_plan_instead_of_repeating_the_cost_card(self):
        from types import SimpleNamespace

        session = SimpleNamespace(conversation_id=uuid4(), owner=self.user, cards=[])
        estimate = ("estimate_total_cost", {"school_key": "psu-phuket"}, {}, "OK")
        agent_runner._add_card(session, *estimate)
        saved = services.save_plan(self.user, {"school_key": "psu-phuket"})
        agent_runner._add_card(session, "save_plan", {"school_key": "psu-phuket"}, saved, "OK")
        agent_runner._add_card(session, *estimate)
        self.assertEqual([c["type"] for c in session.cards], ["plan"])

    def test_choosing_from_a_price_card_saves_the_plan_without_a_model_call(self):
        conversation = self.start()
        url = f"agent/conversations/{conversation['id']}/choose/"
        key = str(uuid4())
        with patch.object(agent_runner, "planner", side_effect=AssertionError("no model call")):
            response = self.client.post(API + url, {"school_key": "psu-phuket", "years": 3.5}, format="json",
                                        HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(response.status_code, 201, response.data)
        turn = response.data["data"]
        self.assertEqual((turn["kind"], turn["status"]), ("user", "COMPLETED"))
        self.assertIn("宋卡王子大学", turn["goal"])
        self.assertIn("3.5 年", turn["final_answer"])
        self.assertEqual([c["type"] for c in turn["cards"]], ["plan"])
        self.assertEqual(turn["cards"][0]["plan"]["years"], 3.5)
        self.assertEqual(turn["steps"][0]["tool"], "save_plan")
        self.assertEqual(services.plan_for(self.user).years, 3.5)
        replay = self.client.post(API + url, {"school_key": "psu-phuket", "years": 3.5}, format="json",
                                  HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual((replay.status_code, replay.data["data"]["id"]), (200, turn["id"]))
        history = self.client.get(API + f"agent/conversations/{conversation['id']}/").data["data"]["turns"]
        self.assertEqual(len(history), 2)


    def test_choosing_schools_keeps_the_latest_three_drafts_and_one_opens_back(self):
        for key in ("psu-phuket", "chulalongkorn", "malaya", "mahidol"):
            services.save_plan(self.user, {"school_key": key})
        services.save_plan(self.user, {"school_key": "malaya", "available_funds": "300000", "funds_currency": "THB"})
        data = self.client.get(API + "planning/history/").data["data"]
        self.assertEqual([d["school_key"] for d in data["drafts"]], ["malaya", "mahidol", "chulalongkorn"])
        self.assertEqual([d["current"] for d in data["drafts"]], [True, False, False])
        # Each draft keeps its own school's length, not the previous school's.
        self.assertEqual([d["years"] for d in data["drafts"]], [3.5, 4, 4])
        self.assertNotIn("available_funds", data["drafts"][0])
        chula = data["drafts"][2]
        response = self.post(f"planning/drafts/{chula['id']}/open/")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(services.plan_for(self.user).school_key, "chulalongkorn")
        self.assertEqual(response.data["data"]["drafts"][0]["school_key"], "chulalongkorn")
        malaya = next(d for d in response.data["data"]["drafts"] if d["school_key"] == "malaya")
        self.assertEqual(self.post(f"planning/drafts/{malaya['id']}/open/").status_code, 201)
        plan = services.plan_for(self.user)
        self.assertEqual(plan.school_key, "malaya")
        plan.status = "CONFIRMED"
        plan.save(update_fields=["status"])
        refused = self.post(f"planning/drafts/{chula['id']}/open/")
        self.assertEqual(refused.status_code, 400, refused.data)


    def test_price_history_covers_every_conversation_newest_first(self):
        first, second = self.start(), self.start()
        self.say(first, "朱拉隆功读4年一共多少钱？")
        self.say(second, "宋卡王子大学（普吉校区）读3.5年一共多少钱？")
        prices = self.client.get(API + "planning/history/").data["data"]["prices"]
        self.assertEqual([p["card"]["school"]["key"] for p in prices[:2]], ["psu-phuket", "chulalongkorn"])
        self.assertEqual({p["conversation_id"] for p in prices[:2]}, {first["id"], second["id"]})

    def test_half_year_courses_are_estimated_and_planned_as_they_run(self):
        from finance.planning.tools import EstimateInput

        entry = catalog.school("psu-phuket")
        self.assertEqual(services.estimate(entry, 3.5)["duration_months"], 42)
        self.assertEqual(services.estimate(entry, 3)["duration_months"], 36)
        self.assertEqual(services.estimate(entry)["years"], 3.5)
        self.assertEqual(services.estimate(catalog.school("chulalongkorn"), 4)["years"], 4)
        self.assertTrue(EstimateInput(data={"school_key": "psu-phuket", "years": 3.5}).is_valid())
        self.assertFalse(EstimateInput(data={"school_key": "psu-phuket", "years": 3.3}).is_valid())
        plan = services.save_plan(self.user, {"school_key": "psu-phuket"})["plan"]
        self.assertEqual((plan["years"], plan["duration_months"]), (3.5, 42))
        plan = services.save_plan(self.user, {"school_key": "chulalongkorn", "years": 4})["plan"]
        self.assertEqual(plan["years"], 4)
        response = self.client.get(API + "planning/schools/psu-phuket/?years=3.5")
        self.assertEqual(response.data["data"]["estimate"]["duration_months"], 42, response.data)
        self.assertEqual(self.client.get(API + "planning/schools/psu-phuket/?years=3.3").status_code, 400)

    def test_money_tools_wait_for_application(self):
        conversation = self.start()
        turn = self.say(conversation, "人民币兑泰铢汇率是多少")
        self.assertFalse(turn["steps"][0].get("tool"))
        self.assertIn("提交贷款申请", turn["final_answer"])

    def test_journey_from_price_to_user_entered_loan(self):
        conversation = self.start()
        cost = self.cards(self.say(conversation, "朱拉隆功读4年一共多少钱？"), "cost")[0]["estimate"]
        self.assertEqual(cost["years"], 4)
        self.assertTrue(cost["lines"])
        comparison = self.cards(self.say(conversation, "比较曼彻斯特和墨尔本"), "comparison")[0]
        self.assertTrue(all(r["total_converted"]["currency"] == "THB" for r in comparison["schools"]))
        plan = self.cards(self.say(conversation, "我们有存款20万人民币，就选朱拉隆功"), "plan")[0]["plan"]
        self.assertEqual((plan["school_key"], plan["status"]), (SCHOOL, "DRAFT"))
        self.assertNotIn("available_funds", plan)
        self.assertNotIn("gap", plan)
        self.say(conversation, "我需要贷款20万泰铢")
        current = self.client.get(API + "planning/assessment/").data["data"]
        self.assertEqual(current["inputs"]["loan"]["principal"], "200000.00")
        turn = self.say(conversation, "确认计划")
        self.assertFalse(self.cards(turn, "confirmation"))
        self.assertEqual(services.plan_for(self.user).status, "DRAFT")

    def test_campus_life_is_answered_when_asked(self):
        conversation = self.start("en")
        turn = self.say(conversation, "What food and fun is near Chulalongkorn?")
        school = self.cards(turn, "school")[0]["school"]
        self.assertEqual(school["key"], SCHOOL)
        self.assertTrue(school["food"] and school["attractions"] and school["facilities"])
        self.assertFalse(self.cards(turn, "cost"))

    def test_opening_conversation_never_proposes_enrollment(self):
        services.save_plan(self.user, {"school_key": SCHOOL})
        plan = StudyPlan.objects.get(owner=self.user)
        services.confirm_plan(self.user, plan)
        with patch.object(services, "today_for", return_value=plan.start_date):
            conversation = self.start()
            self.post(f"agent/conversations/{conversation['id']}/open/")
        self.assertFalse(AgentPendingAction.objects.filter(owner=self.user, action="plan.enroll").exists())
        self.assertEqual(services.plan_for(self.user).status, "CONFIRMED")



    def test_other_users_cannot_read_a_conversation(self):
        conversation = self.start()
        other = get_user_model().objects.create_user("plan-other", password="planning-pass-2")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(API + f"agent/conversations/{conversation['id']}/").status_code, 404)

    def test_message_replay_returns_the_stored_turn(self):
        conversation = self.start()
        url = API + f"agent/conversations/{conversation['id']}/messages/"
        first = self.client.post(url, {"text": "朱拉隆功"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        again = self.client.post(url, {"text": "朱拉隆功"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.data["data"]["id"], again.data["data"]["id"])
        clash = self.client.post(url, {"text": "早稻田"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
        self.assertEqual(clash.status_code, 400)
