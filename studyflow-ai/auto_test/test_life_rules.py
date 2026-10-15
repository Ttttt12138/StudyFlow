import json

from studyflow_ai.agent import AgentContext, Observation, ToolSpec
from studyflow_ai.agent.planning_rules import PlanningRules


def step(text, observations=(), today="2027-08-02"):
    return PlanningRules().next_step(AgentContext(goal=text, locale="zh", steps_remaining=4,
        tools=[ToolSpec(name=n, tier="T1", description=n) for n in ("create_study_task", "get_study_life")],
        observations=list(observations), memory={"today": today, "plan": {"status": "CONFIRMED"}}))


def test_explicit_dates_and_relative_dates_are_not_expense_amounts():
    for text, due in [("提醒我明天交住宿材料", "2027-08-03"), ("下周五提醒我交材料", "2027-08-13"),
                      ("Remind me on 2027-08-12 to register", "2027-08-12")]:
        result = step(text)
        assert result.tool == "create_study_task"
        args = json.loads(result.arguments_json)
        assert args["due_date"] == due
        assert args["source_text"] == text
        assert "amount" not in args


def test_uncertain_date_is_preserved_unknown_and_success_not_repeated():
    text = "提醒我开学前交学费"
    assert json.loads(step(text).arguments_json)["due_date"] is None
    observation = Observation(tool="create_study_task", status="OK", arguments={},
                              result={"task_id": "a", "title": text, "due_date": None})
    answer = step(text, [observation]).answer
    assert "记下了" in answer and "日期还没定" in answer


def test_list_is_read_only_and_failure_does_not_claim_success():
    assert step("有哪些待办和提醒").tool == "get_study_life"
    failed = Observation(tool="create_study_task", status="ERROR", arguments={}, result={})
    assert "没存上" in step("提醒我明天报到", [failed]).answer


def test_one_sentence_keeps_a_labelled_amount_and_ambiguous_amount_stays_unknown():
    args = json.loads(step("提醒我2027-08-08交住宿费2,000泰铢").arguments_json)
    assert (args["amount"], args["currency"], args["due_date"]) == ("2000", "THB", "2027-08-08")
    assert "amount" not in json.loads(step("提醒我明天交200泰铢或300泰铢").arguments_json)
