"""Rule planner for planning conversations (studyflow_ai.agent.planning_rules)."""

import json

from studyflow_ai.agent import AgentContext, AgentPlanner, FinalStep, Observation, RuleAgentProvider, ToolSpec
from studyflow_ai.agent import prompts

PLANNING_TOOLS = ["list_schools", "get_school_profile", "compare_schools", "estimate_total_cost",
                  "get_plan", "save_plan", "simulate_loan", "confirm_plan", "confirm_enrollment", "list_bills",
                  "record_expense", "get_spending", "get_balances", "get_fx_rate", "list_corridors"]
SCHOOLS = [{"key": "chulalongkorn", "name_en": "Chulalongkorn University", "name_zh": "朱拉隆功大学",
            "country_code": "TH", "country_en": "Thailand", "country_zh": "泰国"},
           {"key": "waseda", "name_en": "Waseda University", "name_zh": "早稻田大学",
            "country_code": "JP", "country_en": "Japan", "country_zh": "日本"}]


def context(goal, observations=(), plan=None, locale="zh", **memory):
    return AgentContext(
        goal=goal, locale=locale, steps_remaining=8,
        tools=[ToolSpec(name=n, tier="T0", description=n) for n in PLANNING_TOOLS],
        observations=list(observations),
        memory={"plan": plan, "schools": SCHOOLS, "recent_schools": [], **memory})


def step(goal, **kwargs):
    result, record = AgentPlanner(RuleAgentProvider()).next_step(context(goal, **kwargs))
    assert record.prompt_version == prompts.PLANNING_VERSION
    return result


def args(result):
    return json.loads(result.arguments_json)


def test_no_role_is_needed_and_prices_come_first():
    assert step("朱拉隆功贵吗").tool == "estimate_total_cost"
    assert args(step("朱拉隆功读4年一共多少钱？")) == {"school_key": "chulalongkorn", "years": 4}
    # Saying who you are is neither required nor asked; the catalog is shown with prices.
    assert step("我是家长，孩子明年出国，有哪些学校").tool == "list_schools"
    for goal, locale in [("你好", "zh"), ("hello", "en")]:
        result = step(goal, locale=locale)
        assert isinstance(result, FinalStep)
        assert "家长" not in result.answer and "parent" not in result.answer.lower()


def test_a_bare_school_name_estimates_the_total_cost():
    assert step("早稻田").tool == "estimate_total_cost"
    assert args(step("Waseda", locale="en")) == {"school_key": "waseda"}
    assert step("早稻田周边有什么好吃的").tool == "get_school_profile"


def test_comparison_answer_uses_full_course_totals_and_names_the_cheapest():
    def row(key, zh, en, total, home):
        return {"key": key, "name": {"zh": zh, "en": en}, "currency": "THB", "years": 4, "duration_years": 4,
                "first_year_total": "1.00", "total": total, "total_converted": None if home is None else home}
    compared = Observation(tool="compare_schools", status="OK", arguments={}, result={
        "home_currency": "THB", "cheapest": "chulalongkorn", "schools": [
            row("waseda", "早稻田大学", "Waseda University", "2000000.00", None),
            row("chulalongkorn", "朱拉隆功大学", "Chulalongkorn University", "1500000.00", None)]})
    answer = step("比较早稻田和朱拉隆功", observations=[compared]).answer
    assert "2,000,000 THB" in answer and "1,500,000 THB" in answer and "最低的是朱拉隆功大学，比最贵的一所少约 500,000 THB" in answer


def test_country_filter_and_comparison():
    assert args(step("日本有什么学校")) == {"country_code": "JP"}
    assert args(step("比较早稻田和朱拉隆功")) == {"school_keys": ["waseda", "chulalongkorn"]}


def test_savings_and_choice_save_the_plan_with_funds():
    result = step("我们有存款30万人民币，就选早稻田")
    assert result.tool == "save_plan"
    assert args(result) == {"school_key": "waseda", "available_funds": "300000.00", "funds_currency": "CNY"}


def test_loan_needs_a_gap_first():
    asks = step("帮我贷款")
    assert isinstance(asks, FinalStep) and "准备" in asks.answer
    plan = {"status": "DRAFT", "school_key": "waseda", "gap": "1000.00"}
    assert args(step("帮我贷款，分36个月", plan=plan)) == {"months": 36}


def test_enrollment_and_confirmation_are_only_proposed():
    plan = {"status": "DRAFT", "school_key": "waseda", "gap": "0.00"}
    assert step("确认计划", plan=plan).tool == "confirm_plan"
    assert step("孩子已经到校报到了").tool == "confirm_enrollment"


def test_answers_only_quote_numbers_from_observations():
    estimate = Observation(tool="estimate_total_cost", status="OK", arguments={"school_key": "waseda"}, result={
        "currency": "JPY", "years": 4, "total": "9000000.00", "total_low": "8000000.00", "total_high": "9900000.00",
        "estimated_share": "31.4", "groups": {"tuition": "6000000.00", "living": "2500000.00",
                                              "essentials": "500000.00"}})
    answer = step("早稻田全部费用", observations=[estimate]).answer
    assert "9,000,000 JPY" in answer and "31%" in answer and "示例数据" in answer


ENROLLED = {"status": "ENROLLED", "school_key": "waseda", "gap": "0.00"}


def test_enrolled_students_record_spending_and_ask_for_bills():
    spent = step("今天午饭花了120泰铢", plan=ENROLLED)
    assert spent.tool == "record_expense"
    assert args(spent) == {"amount": "120.00", "note": "今天午饭花了120泰铢", "currency": "THB"}
    assert step("这个月花了多少？", plan=ENROLLED).tool == "get_spending"
    assert step("接下来有哪些账单", plan=ENROLLED).tool == "list_bills"


def test_wallet_and_fx_requests_reach_the_finance_rules_after_enrollment():
    assert step("人民币兑泰铢汇率是多少", plan=ENROLLED).tool == "get_fx_rate"
    assert step("我的余额是多少", plan=ENROLLED).tool == "get_balances"
    # A spending message with a currency word is not a conversion request.
    assert step("打车花了85泰铢", plan=ENROLLED).tool == "record_expense"


def test_spending_answer_uses_local_labels():
    recorded = Observation(tool="record_expense", status="OK", arguments={"amount": "120.00"}, result={
        "expense": {"spent_on": "2027-08-14", "amount": "120.00", "currency": "THB", "category": "food"},
        "month": "2027-08", "currency": "THB", "spent": "120.00", "budget": "24300.00", "remaining": "24180.00",
        "over_budget": False})
    answer = step("午饭花了120泰铢", plan=ENROLLED, observations=[recorded]).answer
    assert "餐饮" in answer and "food" not in answer and "24,180 THB" in answer


def test_preparation_and_denied_arrival_never_propose_enrollment():
    plan = {"status": "CONFIRMED", "school_key": "waseda"}
    for goal in ["还没报到", "尚未入学", "还在准备", "I have not arrived", "I'm not enrolled yet", "Still preparing", "日期有变化", "My start date has changed", "明天去报到", "How do I enroll?"]:
        result = step(goal, plan=plan, enrollment_due=True)
        assert isinstance(result, FinalStep), (goal, result)


def test_money_tools_are_locked_before_enrollment():
    for plan in (None, {"status": "DRAFT", "school_key": "waseda"}, {"status": "CONFIRMED", "school_key": "waseda"}):
        for goal in ["人民币兑泰铢汇率是多少", "我的余额是多少", "把1000人民币换成泰铢", "汇款5000泰铢给学校"]:
            result = step(goal, plan=plan)
            assert isinstance(result, FinalStep), (goal, plan, result)
            assert "确认入学后开放" in result.answer
    english = step("What is my balance?", locale="en")
    assert isinstance(english, FinalStep) and "once enrollment is confirmed" in english.answer
    # Planning questions that merely mention status are not wallet requests.
    assert step("我的计划进度").tool == "get_plan"
    # Loans stay available before enrollment.
    plan = {"status": "DRAFT", "school_key": "waseda", "gap": "1000.00"}
    assert step("帮我贷款，分36个月", plan=plan).tool == "simulate_loan"


def test_preparation_topics_are_read_only_and_campus_questions_stay_available():
    assert isinstance(step("出发准备"), FinalStep)
    plan = {"status": "CONFIRMED", "school_key": "waseda"}
    for goal in ["出发准备", "首月预算", "Departure preparation", "First-month budget"]:
        result = step(goal, plan=plan)
        assert isinstance(result, FinalStep), (goal, result)
    assert step("学校周边有什么好吃的？", plan=ENROLLED).tool == "get_school_profile"
    assert args(step("What food is near my school?", plan=ENROLLED,
                     recent_schools=["chulalongkorn"])) == {"school_key": "waseda"}


def test_due_date_alone_or_vague_confirmation_is_not_arrival():
    plan = {"status": "CONFIRMED", "school_key": "waseda"}
    assert isinstance(step("确认", plan=plan, enrollment_due=True), FinalStep)
    assert step("我已完成报到", plan=plan).tool == "confirm_enrollment"
