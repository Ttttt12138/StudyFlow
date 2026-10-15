"""Loan objections keep their meaning without being confused with a school or a new amount."""
import json

import pytest

from studyflow_ai.agent import AgentContext, AgentPlanner, RuleAgentProvider, ToolSpec


def ask(text, advice=None):
    context = AgentContext(goal=text, locale="zh", steps_remaining=8,
        tools=[ToolSpec(name=n, tier="T1", description=n) for n in ("get_plan", "save_plan", "simulate_loan", "list_schools", "estimate_total_cost")],
        memory={"schools": [], "plan": {"status": "DRAFT", "school_key": "psu-phuket", "loan_advice": advice or {}}})
    result, _ = AgentPlanner(RuleAgentProvider()).next_step(context)
    return (result.tool, json.loads(result.arguments_json)) if result.kind == "tool_call" else (None, {})


@pytest.mark.parametrize("text,intent", [
    ("月供太高了", "lower_monthly"), ("monthly payment is too high", "lower_monthly"),
    ("不想多付利息", "lower_interest"), ("I want to pay less interest", "lower_interest"),
    ("不想借这么多", "reduce_amount"), ("I'd like to borrow less", "reduce_amount"),
    ("不要推荐贷款了", "pause"), ("I'm not interested", "pause"),
    ("继续推荐贷款", "resume"), ("就按这个方案申请", "apply"),
])
def test_concerns_route_to_the_existing_loan(text, intent):
    tool, body = ask(text)
    assert tool == "simulate_loan"
    assert body == {"intent": intent}


@pytest.mark.parametrize("text", ["36个月", "4年", "4.5%", "学费30000泰铢"])
def test_an_amount_reply_does_not_extract_terms_rates_or_tuition(text):
    _, body = ask(text, {"status": "needs_amount"})
    assert "principal" not in body


@pytest.mark.parametrize("text,principal,currency", [("30000泰铢", "30000.00", "THB"), ("CNY 2万", "20000.00", "CNY")])
def test_a_short_reply_after_the_amount_question(text, principal, currency):
    tool, body = ask(text, {"status": "needs_amount"})
    assert tool == "simulate_loan"
    assert body == {"principal": principal, "principal_currency": currency}
