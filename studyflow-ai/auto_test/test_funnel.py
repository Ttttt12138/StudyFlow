"""Every reply moves the user to the next step of the core flow, in a warm voice (studyflow_ai.agent.funnel)."""

import re

from studyflow_ai.agent import (
    AgentContext,
    AgentPlanner,
    Observation,
    RuleAgentProvider,
    ToolSpec,
    funnel,
    life_rules,
    loan_rules,
    planning_rules,
    preparation,
    prompts,
)
from studyflow_ai.agent.planner import LiveAgentProvider

TOOLS = ["list_schools", "get_school_profile", "compare_schools", "estimate_total_cost", "get_plan", "save_plan",
         "simulate_loan", "list_bills", "get_balances", "get_fx_rate", "list_corridors"]
# Words a user should never read: tool and field names, status values, error codes, stiff boilerplate.
INTERNAL = re.compile(r"[a-z]+_[a-z_]+|\b(DRAFT|CONFIRMED|ERROR|DENIED|INVALID_[A-Z_]+)\b|下一步可|下一步：|请稍后再试")


def context(goal, plan=None, recent=(), observations=(), locale="zh"):
    # With results already in, the planner is asked to finish (steps_remaining=0), as after a tool cycle.
    return AgentContext(goal=goal, locale=locale, steps_remaining=0 if observations else 8,
                        tools=[ToolSpec(name=n, tier="T0", description=n) for n in TOOLS],
                        observations=list(observations),
                        memory={"plan": plan, "recent_schools": list(recent), "schools": []})


def test_the_stage_follows_the_core_flow():
    assert funnel.base_stage({}) == "price"
    assert funnel.base_stage({"recent_schools": ["waseda"]}) == "compare"
    assert funnel.base_stage({"recent_schools": ["waseda", "nus"]}) == "choose"
    assert funnel.base_stage({"plan": {"status": "DRAFT"}}) == "amount"
    for advice, expected in [("needs_amount", "amount"), ("recommended", "apply"), ("paused", "paused"),
                             ("submitted", "applied")]:
        assert funnel.base_stage({"plan": {"status": "DRAFT", "loan_advice": {"status": advice}}}) == expected
    assert funnel.base_stage({"plan": {"status": "CONFIRMED"}}) == "applied"


def test_this_turns_results_move_the_stage_forward():
    listed = Observation(tool="list_schools", status="OK", result={"schools": [{"key": "a"}, {"key": "b"}]})
    estimate = Observation(tool="estimate_total_cost", status="OK", result={"total": "1"})
    failed = Observation(tool="list_schools", status="ERROR", result={"error": "X"})
    assert funnel.stage({}, [listed]) == "choose"
    assert funnel.stage({}, [estimate]) == "compare"
    assert funnel.stage({}, [failed]) == "price"
    saved = Observation(tool="save_plan", status="OK", result={"plan": {"status": "DRAFT"}})
    assert funnel.stage({}, [saved]) == "amount"
    advice = Observation(tool="simulate_loan", status="OK", result={"advice": {"status": "recommended"}})
    assert funnel.stage({"plan": {"status": "DRAFT"}}, [advice]) == "apply"


def test_invitations_are_one_question_and_a_paused_loan_is_not_pushed():
    for name in funnel.STAGES:
        zh, en = funnel.INVITES[name]
        assert zh.count("？") <= 1 and en.count("?") <= 1, name
        assert not INTERNAL.search(zh) and not INTERNAL.search(en), name
    assert "贷款" not in funnel.invite("paused", "zh") and "loan" not in funnel.invite("paused", "en")
    # The card buttons the invitations name are the ones the cards show.
    assert "「选这所」" in funnel.invite("choose", "zh") and "「按此方案申请」" in funnel.invite("apply", "zh")


def test_every_template_reads_like_a_person():
    texts = [*funnel.DISCLOSURE.values(), *[t for pair in funnel.INVITES.values() for t in pair]]
    for name in ("SAMPLE", "AFTER_APPLICATION", "HELP", "SUBMITTED", "NO_EXPENSES", "FAILED", "FAILED_ONLY"):
        texts += getattr(planning_rules, name).values()
    product = {"key": "commercial_student_demo", "annual_rate": "0.06"}
    row = {"product": "commercial_student_demo", "annual_rate": "0.06", "principal": "300000", "months": 36,
           "monthly_payment": "9200", "total_interest": "31000", "fees": "1500", "total_repayment": "332500"}
    for advice in ({"status": "paused"}, {"status": "submitted"}, {"status": "needs_amount", "product": product},
                   {"status": "needs_amount", "intent": "reduce_amount"},
                   {"status": "recommended", "intent": "lower_monthly", "selected": row}):
        for locale in ("zh", "en"):
            texts.append(loan_rules.advice_reply(advice, locale))
    for goal in ("出发准备", "首月预算", "日期有变化", "确认"):
        texts.append(preparation.preparation_reply(goal, "CONFIRMED", "zh"))
    for text in texts:
        assert not INTERNAL.search(text), text
        assert "均为模拟" not in text and "are simulated" not in text or text in funnel.DISCLOSURE.values(), text
    assert life_rules  # imported so its strings are covered by the planner tests


def test_rule_replies_answer_then_invite_the_next_step():
    cases = [
        (context("你好"), "price"),
        (context("帮我贷款"), "price"),
        (context("早稻田全部费用", observations=[Observation(tool="estimate_total_cost", status="OK", result={
            "currency": "JPY", "years": 4, "total": "9000000", "groups": {"tuition": "6000000", "living": "2500000",
                                                                         "essentials": "500000"}})]), "compare"),
        (context("有哪些学校", observations=[Observation(tool="list_schools", status="OK", result={"schools": [
            {"key": "a", "name": {"zh": "甲大学"}, "country": {"zh": "泰国", "en": "Thailand"}, "total": "1",
             "currency": "THB", "total_home": "1", "home_currency": "CNY"},
            {"key": "b", "name": {"zh": "乙大学"}, "country": {"zh": "泰国", "en": "Thailand"}, "total": "2",
             "currency": "THB", "total_home": "2", "home_currency": "CNY"}]})]), "choose"),
        (context("你好", plan={"status": "DRAFT", "loan_advice": {"status": "paused"}}), "paused"),
        (context("你好", plan={"status": "CONFIRMED"}), "applied"),
    ]
    for ctx, expected in cases:
        step, _ = AgentPlanner(RuleAgentProvider()).next_step(ctx)
        assert step.answer.endswith(funnel.invite(expected, "zh")), (ctx.goal, step.answer)
        assert not INTERNAL.search(step.answer), step.answer


def test_a_failed_lookup_is_explained_without_codes():
    failed = Observation(tool="list_schools", status="ERROR", result={"error": "CATALOG_UNAVAILABLE"})
    step, _ = AgentPlanner(RuleAgentProvider()).next_step(context("有哪些学校", observations=[failed]))
    assert "没查成功" in step.answer and "CATALOG" not in step.answer and "list_schools" not in step.answer


# --- live replies that break the JSON contract ---------------------------------------------------


class Replies:
    """A provider that fails with the given raw replies, then answers with `final`."""

    def __init__(self, raws, final="好的", user_facing=False):
        from studyflow_ai.models import CallRecord
        from studyflow_ai.providers.base import ProviderFailure

        self.calls, self.final, self.user_facing, self.failures = [], final, user_facing, []
        for raw in raws:
            failure = ProviderFailure("INVALID_MODEL_OUTPUT", CallRecord(
                provider="openai", purpose="plan", model="m", mode="live", error_code="INVALID_MODEL_OUTPUT"))
            failure.raw_output = raw
            self.failures.append(failure)

    def _request(self, purpose, text, schema, instruction):
        from studyflow_ai.agent.models import FinalStep, PlannerOutput, ProseVerdict
        from studyflow_ai.models import CallRecord

        self.calls.append(instruction)
        if schema is ProseVerdict:
            return ProseVerdict(user_facing=self.user_facing), CallRecord(
                provider="openai", purpose="plan", model="m", mode="live")
        if self.failures:
            raise self.failures.pop(0)
        return PlannerOutput(step=FinalStep(answer=self.final)), CallRecord(
            provider="openai", purpose="plan", model="m", mode="live")


def test_an_answer_with_raw_line_breaks_is_recovered_without_a_retry():
    # Observed live (planning-2.3): a markdown list inside the JSON answer string, with raw line breaks.
    raw = '{"step":{"kind":"final","answer":"泰国有 5 所学校：\n- 甲\n- 乙"}}'
    provider = Replies([raw])
    step, record = AgentPlanner(LiveAgentProvider(provider)).next_step(context("比较一下泰国的大学"))
    assert step.answer == "泰国有 5 所学校：\n- 甲\n- 乙" and len(provider.calls) == 1
    assert record.error_code is None


def test_broken_json_is_retried_once_in_a_planning_conversation_and_kept_for_diagnosis():
    provider = Replies(['{"step": {"kind": "final", "answer": "cut off'])
    step, record = AgentPlanner(LiveAgentProvider(provider)).next_step(context("比较一下泰国的大学"))
    assert step.answer == "好的" and len(provider.calls) == 2 and record.attempts == 2
    provider = Replies(['{"step": {"kind": "final"'] * 2)
    step, record = AgentPlanner(LiveAgentProvider(provider)).next_step(context("比较一下泰国的大学"))
    assert len(provider.calls) == 2 and record.mode == "rules"
    assert record.raw_excerpt == '{"step": {"kind": "final"'


def test_a_finished_answer_in_plain_text_is_used_after_a_short_check():
    # Observed live (planning-2.4): "普吉校区周边有什么好吃的" got a good answer as plain text three times.
    prose = "普吉校区附近有校园食堂和卡图小吃摊。看下来哪所最合心意？"
    provider = Replies([prose], user_facing=True)
    step, record = AgentPlanner(LiveAgentProvider(provider)).next_step(context("普吉校区周边有什么好吃的"))
    assert step.answer == prose and record.mode == "live" and record.error_code is None
    assert provider.calls[1] == prompts.PROSE_VERDICT and len(provider.calls) == 2
    # Reasoning is not shown: it goes back to the planner as a structured retry.
    provider = Replies(["Need tool list_schools first."], user_facing=False)
    step, _ = AgentPlanner(LiveAgentProvider(provider)).next_step(context("有哪些学校"))
    assert step.answer == "好的" and len(provider.calls) == 3 and "<<<" in provider.calls[2]


def test_prose_with_a_broken_json_tail_is_retried_even_if_the_judge_would_accept_it():
    for tail in ('"}', '\\"}', '"}}'):
        provider = Replies(["Choose a school to continue." + tail], final="Choose a school to continue.",
                           user_facing=True)
        step, record = AgentPlanner(LiveAgentProvider(provider)).next_step(context("Compare Thai schools"))
        assert step.answer == "Choose a school to continue."
        assert record.mode == "live" and len(provider.calls) == 2
        assert prompts.PROSE_VERDICT not in provider.calls
