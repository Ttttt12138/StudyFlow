"""Rule planner for planning conversations (studyflow_ai.agent.planning_rules)."""

import json

from studyflow_ai.agent import AgentContext, AgentPlanner, FinalStep, Observation, RuleAgentProvider, ToolSpec
from studyflow_ai.agent import prompts

PLANNING_TOOLS = ["set_role", "list_schools", "get_school_profile", "compare_schools", "estimate_total_cost",
                  "get_plan", "save_plan", "simulate_loan", "confirm_plan", "confirm_enrollment", "list_bills",
                  "record_expense", "get_spending", "get_balances", "get_fx_rate", "list_corridors"]
SCHOOLS = [{"key": "chulalongkorn", "name_en": "Chulalongkorn University", "name_zh": "朱拉隆功大学",
            "country_code": "TH", "country_en": "Thailand", "country_zh": "泰国"},
           {"key": "waseda", "name_en": "Waseda University", "name_zh": "早稻田大学",
            "country_code": "JP", "country_en": "Japan", "country_zh": "日本"}]


def context(goal, role=None, observations=(), plan=None, locale="zh", **memory):
    return AgentContext(
        goal=goal, locale=locale, steps_remaining=8,
        tools=[ToolSpec(name=n, tier="T0", description=n) for n in PLANNING_TOOLS],
        observations=list(observations),
        memory={"role": role, "plan": plan, "schools": SCHOOLS, "recent_schools": [], **memory})


def step(goal, **kwargs):
    result, record = AgentPlanner(RuleAgentProvider()).next_step(context(goal, **kwargs))
    assert record.prompt_version == prompts.PLANNING_VERSION
    return result


def args(result):
    return json.loads(result.arguments_json)


def test_unknown_role_gets_one_question_and_no_tool():
    result = step("朱拉隆功贵吗")
    assert isinstance(result, FinalStep) and "家长" in result.answer


def test_stated_role_is_recorded_then_catalog_listed():
    first = step("我是家长，孩子明年出国")
    assert first.tool == "set_role" and args(first) == {"role": "parent"}
    done = Observation(tool="set_role", status="OK", result={"role": "parent"})
    assert step("我是家长，孩子明年出国", observations=[done]).tool == "list_schools"


def test_parent_naming_a_school_gets_costs_and_student_gets_campus_life():
    assert step("早稻田", role="parent").tool == "estimate_total_cost"
    assert step("早稻田", role="student").tool == "get_school_profile"
    assert args(step("朱拉隆功读3年全部费用", role="student")) == {"school_key": "chulalongkorn", "years": 3}


def test_country_filter_and_comparison():
    assert args(step("日本有什么学校", role="parent")) == {"country_code": "JP"}
    assert args(step("比较早稻田和朱拉隆功", role="parent")) == {"school_keys": ["waseda", "chulalongkorn"]}


def test_savings_and_choice_save_the_plan_with_funds():
    result = step("我们有存款30万人民币，就选早稻田", role="parent")
    assert result.tool == "save_plan"
    assert args(result) == {"school_key": "waseda", "available_funds": "300000.00", "funds_currency": "CNY"}


def test_loan_needs_a_gap_first():
    asks = step("帮我贷款", role="parent")
    assert isinstance(asks, FinalStep) and "准备" in asks.answer
    plan = {"status": "DRAFT", "school_key": "waseda", "gap": "1000.00"}
    assert args(step("帮我贷款，分36个月", role="parent", plan=plan)) == {"months": 36}


def test_enrollment_and_confirmation_are_only_proposed():
    plan = {"status": "DRAFT", "school_key": "waseda", "gap": "0.00"}
    assert step("确认计划", role="parent", plan=plan).tool == "confirm_plan"
    assert step("孩子已经到校报到了", role="parent").tool == "confirm_enrollment"


def test_answers_only_quote_numbers_from_observations():
    estimate = Observation(tool="estimate_total_cost", status="OK", arguments={"school_key": "waseda"}, result={
        "currency": "JPY", "years": 4, "total": "9000000.00", "total_low": "8000000.00", "total_high": "9900000.00",
        "estimated_share": "31.4", "groups": {"tuition": "6000000.00", "living": "2500000.00",
                                              "essentials": "500000.00"}})
    answer = step("早稻田全部费用", role="parent", observations=[estimate]).answer
    assert "9,000,000 JPY" in answer and "31%" in answer and "示例数据" in answer


ENROLLED = {"status": "ENROLLED", "school_key": "waseda", "gap": "0.00"}


def test_enrolled_students_record_spending_and_ask_for_bills():
    spent = step("今天午饭花了120泰铢", role="student", plan=ENROLLED)
    assert spent.tool == "record_expense"
    assert args(spent) == {"amount": "120.00", "note": "今天午饭花了120泰铢", "currency": "THB"}
    assert step("这个月花了多少？", role="student", plan=ENROLLED).tool == "get_spending"
    assert step("接下来有哪些账单", role="student", plan=ENROLLED).tool == "list_bills"


def test_wallet_and_fx_requests_reach_the_finance_rules():
    assert step("人民币兑泰铢汇率是多少", role="student", plan=ENROLLED).tool == "get_fx_rate"
    assert step("我的余额是多少", role="parent").tool == "get_balances"
    # A spending message with a currency word is not a conversion request.
    assert step("打车花了85泰铢", role="student", plan=ENROLLED).tool == "record_expense"


def test_spending_answer_uses_local_labels():
    recorded = Observation(tool="record_expense", status="OK", arguments={"amount": "120.00"}, result={
        "expense": {"spent_on": "2027-08-14", "amount": "120.00", "currency": "THB", "category": "food"},
        "month": "2027-08", "currency": "THB", "spent": "120.00", "budget": "24300.00", "remaining": "24180.00",
        "over_budget": False})
    answer = step("午饭花了120泰铢", role="student", plan=ENROLLED, observations=[recorded]).answer
    assert "餐饮" in answer and "food" not in answer and "24,180 THB" in answer


def test_preparation_and_denied_arrival_never_propose_enrollment():
    plan = {"status": "CONFIRMED", "school_key": "waseda"}
    for goal in ["还没报到", "尚未入学", "还在准备", "I have not arrived", "I'm not enrolled yet", "Still preparing", "日期有变化", "My start date has changed", "明天去报到", "How do I enroll?"]:
        result = step(goal, role="student", plan=plan, enrollment_due=True)
        assert isinstance(result, FinalStep), (goal, result)


def test_preparation_topics_are_read_only_and_campus_questions_stay_available():
    assert step("我是学生，出发准备").tool == "set_role"
    recorded = Observation(tool="set_role", status="OK", result={"role": "student"})
    assert isinstance(step("我是学生，出发准备", observations=[recorded]), FinalStep)
    plan = {"status": "CONFIRMED", "school_key": "waseda"}
    for goal in ["出发准备", "首月预算", "Departure preparation", "First-month budget"]:
        result = step(goal, role="student", plan=plan)
        assert isinstance(result, FinalStep), (goal, result)
    assert step("学校周边有什么好吃的？", role="student", plan=ENROLLED).tool == "get_school_profile"
    assert args(step("What food is near my school?", role="student", plan=ENROLLED,
                     recent_schools=["chulalongkorn"])) == {"school_key": "waseda"}


def test_due_date_alone_or_vague_confirmation_is_not_arrival():
    plan = {"status": "CONFIRMED", "school_key": "waseda"}
    assert isinstance(step("确认", role="student", plan=plan, enrollment_due=True), FinalStep)
    assert step("我已完成报到", role="student", plan=plan).tool == "confirm_enrollment"
