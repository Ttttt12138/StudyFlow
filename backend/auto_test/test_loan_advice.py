"""Conversational loan recommendations use real quotes and leave submission to the user."""
import json
from decimal import Decimal
from unittest.mock import patch

from finance import agent_runner
from finance.planning import assessment, services
from finance.workflow_models import Disbursement, SimulatedApplication

from auto_test.test_planning import ConversationHarness


class LoanAdviceTests(ConversationHarness):
    username = "loan-advice"

    def setUp(self):
        super().setUp()
        services.save_plan(self.user, {"school_key": "psu-phuket"})
        self.conversation = self.start()

    def advise(self, text):
        turn = self.say(self.conversation, text)
        cards = self.cards(turn, "loan_advice")
        self.assertTrue(cards, turn)
        return cards[-1]["advice"], turn

    def current(self):
        return self.client.get("/api/v2/planning/assessment/").data["data"]

    def test_school_choice_proactively_recommends_but_never_invents_principal(self):
        response = self.post(f"agent/conversations/{self.conversation['id']}/choose/", {"school_key": "psu-phuket"})
        self.assertEqual(response.status_code, 201, response.data)
        advice = self.cards(response.data["data"], "loan_advice")[-1]["advice"]
        self.assertEqual(advice["status"], "needs_amount")
        self.assertEqual(advice["product"]["key"], "commercial_student_demo")
        self.assertIsNone(self.current()["inputs"]["loan"]["principal"])
        self.assertFalse(SimulatedApplication.objects.exists())

    def test_recommendation_creates_current_quote_with_all_costs_and_no_application(self):
        advice, turn = self.advise("我想贷款48000泰铢")
        selected = advice["selected"]
        self.assertEqual((selected["principal"], selected["product"], selected["months"]),
                         ("48000.00", "commercial_student_demo", 48))
        self.assertEqual(Decimal(selected["annual_rate"]), Decimal("0.045"))
        quote = self.current()["quotes"][0]
        self.assertEqual(advice["quote_id"], quote["id"])
        for key in ("total_interest", "total_repayment", "fees", "net_proceeds"):
            self.assertEqual(selected[key], quote["result"][key])
        self.assertIn("推荐", turn["final_answer"])
        self.assertFalse(SimulatedApplication.objects.exists())
        self.assertFalse(Disbursement.objects.exists())
        for step in turn["steps"]:
            if step.get("tool") == "simulate_loan":
                self.assertNotIn("truncated", step["result"])
                self.assertLessEqual(len(json.dumps(step["result"], ensure_ascii=False)), agent_runner.RESULT_CHARS)

    def test_monthly_and_interest_objections_recalculate_and_explain_the_tradeoff(self):
        first, _ = self.advise("贷款48000泰铢")
        lower, turn = self.advise("月供太高了")
        self.assertEqual(lower["selected"]["months"], 60)
        self.assertLess(Decimal(lower["selected"]["monthly_payment"]), Decimal(first["selected"]["monthly_payment"]))
        self.assertGreater(Decimal(lower["change"]["total_interest"]), 0)
        self.assertIn("总利息", turn["final_answer"])
        cheaper, _ = self.advise("不想多付利息")
        self.assertEqual(cheaper["selected"]["months"], 24)
        self.assertLess(Decimal(cheaper["selected"]["total_interest"]), Decimal(lower["selected"]["total_interest"]))
        self.assertGreater(Decimal(cheaper["change"]["monthly_payment"]), 0)

    def test_reducing_amount_asks_only_for_amount_then_preserves_terms(self):
        self.advise("贷款48000泰铢，分36个月")
        advice, _ = self.advise("不想借这么多")
        self.assertEqual(advice["status"], "needs_amount")
        self.assertEqual(self.current()["inputs"]["loan"]["principal"], "48000.00")
        reduced, _ = self.advise("30000泰铢")
        self.assertEqual((reduced["selected"]["principal"], reduced["selected"]["months"]), ("30000.00", 36))
        self.assertLess(Decimal(reduced["change"]["monthly_payment"]), 0)

    def test_bare_amount_after_initial_question_and_currency_conversion(self):
        self.advise("推荐一个贷款方案")
        advice, _ = self.advise("10000人民币")
        expected = services.convert("10000", "CNY", "THB")["amount"]
        self.assertEqual(advice["selected"]["principal"], expected)

    def test_decline_survives_another_conversation_until_explicit_resume(self):
        self.advise("贷款48000泰铢")
        paused, _ = self.advise("暂时不考虑贷款，不要推荐了")
        self.assertEqual(paused["status"], "paused")
        count = assessment.latest(services.plan_for(self.user)).version
        self.conversation = self.start()
        turn = self.say(self.conversation, "我的计划")
        self.assertFalse(self.cards(turn, "loan_advice"))
        self.assertEqual(assessment.latest(services.plan_for(self.user)).version, count)
        resumed, _ = self.advise("继续推荐贷款")
        self.assertEqual(resumed["status"], "recommended")

    def test_acceptance_prepares_confirmation_then_the_existing_endpoint_submits_once(self):
        first, _ = self.advise("贷款48000泰铢")
        advice, _ = self.advise("就按这个方案申请")
        self.assertTrue(advice["ready_to_apply"])
        self.assertEqual(advice["quote_id"], first["quote_id"])
        self.assertFalse(SimulatedApplication.objects.exists())
        body = {"expected_version": advice["assessment_version"], "plan_version": advice["plan_version"],
                "quote_id": advice["quote_id"]}
        response = self.post("planning/plan/confirm/", body)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(SimulatedApplication.objects.count(), 1)
        self.assertFalse(Disbursement.objects.exists())
        submitted, _ = self.advise("再推荐一个贷款方案")
        self.assertEqual(submitted["status"], "submitted")

    def test_old_recommendation_cannot_submit_after_new_quote(self):
        first, _ = self.advise("贷款48000泰铢")
        self.advise("月供太高")
        response = self.post("planning/plan/confirm/", {"expected_version": first["assessment_version"],
            "plan_version": first["plan_version"], "quote_id": first["quote_id"]})
        self.assertEqual(response.status_code, 409, response.data)
        self.assertFalse(SimulatedApplication.objects.exists())

    def test_recommendation_uses_actual_product_rates(self):
        plan = services.plan_for(self.user)
        inputs = assessment.defaults(self.user, plan)
        inputs["loan"].update(principal="48000.00", annual_rate="0.02")
        assessment.save(self.user, {"expected_version": 0, "plan_version": plan.version, "inputs": inputs, "draft": True})
        advice, _ = self.advise("推荐一个贷款方案")
        self.assertEqual(advice["selected"]["product"], "custom")
        self.assertEqual(Decimal(advice["selected"]["annual_rate"]), Decimal("0.02"))

    def test_explicit_method_and_product_are_respected(self):
        advice, _ = self.advise("贷款48000泰铢，在校期间只还利息")
        self.assertEqual(advice["selected"]["method"], "interest_only")
        self.assertGreater(advice["selected"]["interest_only_months"], 0)
        self.assertGreater(Decimal(advice["selected"]["monthly_payment"]),
                           Decimal(advice["selected"]["interest_only_payment"]))

    def test_terms_said_before_amount_and_custom_product_survive_followups(self):
        self.advise("自定义贷款，分36个月")
        first, _ = self.advise("48000 THB")
        self.assertEqual((first["selected"]["product"], first["selected"]["months"]), ("custom", 36))
        self.advise("不想借这么多")
        smaller, _ = self.advise("30000 THB")
        self.assertEqual((smaller["selected"]["product"], smaller["selected"]["months"]), ("custom", 36))

    def test_amount_above_course_limit_does_not_create_an_application_or_quote(self):
        turn = self.say(self.conversation, "贷款999999999泰铢")
        self.assertFalse(self.cards(turn, "loan_advice"))
        self.assertFalse(self.current()["quotes"])
        self.assertFalse(SimulatedApplication.objects.exists())

    def test_a_successful_recommendation_finishes_without_another_model_call(self):
        from studyflow_ai.agent import AgentPlanner, ToolCallStep
        from studyflow_ai.models import CallRecord

        class Once:
            calls = 0

            def next_step(self, context):
                self.calls += 1
                if self.calls > 1:
                    raise AssertionError("a second model call must not repeat the loan calculation")
                return (ToolCallStep(tool="simulate_loan", arguments_json='{"principal":"48000.00"}'),
                        CallRecord(provider="test", model="test", purpose="plan", mode="mock"))

        provider = Once()
        with patch.object(agent_runner, "planner", lambda: AgentPlanner(provider)):
            advice, turn = self.advise("贷款48000泰铢")
        self.assertEqual(provider.calls, 1)
        self.assertEqual(advice["selected"]["principal"], "48000.00")
        self.assertEqual(turn["steps"][-1]["call"]["provider"], "system")
