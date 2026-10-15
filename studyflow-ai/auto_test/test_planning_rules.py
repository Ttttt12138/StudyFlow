"""Rule planner for planning conversations (studyflow_ai.agent.planning_rules)."""

import json

from studyflow_ai.agent import (
    AgentContext,
    AgentPlanner,
    FinalStep,
    Observation,
    RuleAgentProvider,
    ToolSpec,
    funnel,
    prompts,
)

PLANNING_TOOLS = ["list_schools", "get_school_profile", "compare_schools", "estimate_total_cost",
                  "get_plan", "save_plan", "simulate_loan", "list_bills", "get_balances", "get_fx_rate",
                  "list_corridors", "get_credit_profile"]
REMOVED_TOOLS = {"confirm_plan", "confirm_enrollment", "record_expense", "get_spending"}
SCHOOLS = [{"key": "chulalongkorn", "name_en": "Chulalongkorn University", "name_zh": "朱拉隆功大学",
            "country_code": "TH", "country_en": "Thailand", "country_zh": "泰国"},
           {"key": "waseda", "name_en": "Waseda University", "name_zh": "早稻田大学",
            "country_code": "JP", "country_en": "Japan", "country_zh": "日本"}]
DRAFT = {"status": "DRAFT", "school_key": "waseda"}
CONFIRMED = {"status": "CONFIRMED", "school_key": "waseda"}


def context(goal, observations=(), plan=None, locale="zh", tools=PLANNING_TOOLS, **memory):
    return AgentContext(
        goal=goal, locale=locale, steps_remaining=8,
        tools=[ToolSpec(name=n, tier="T0", description=n) for n in tools],
        observations=list(observations),
        memory={"plan": plan, "schools": SCHOOLS, "recent_schools": [], **memory})


def step(goal, **kwargs):
    result, record = AgentPlanner(RuleAgentProvider()).next_step(context(goal, **kwargs))
    assert record.prompt_version == prompts.PLANNING_VERSION
    return result


def args(result):
    return json.loads(result.arguments_json)


def saved(status="DRAFT"):
    return Observation(tool="save_plan", status="OK", arguments={"school_key": "waseda"}, result={
        "plan": {"status": status, "school_key": "waseda", "years": 4, "currency": "JPY", "total": "9000000.00",
                 "school": {"name": {"zh": "早稻田大学", "en": "Waseda University"}}}})


def test_prompt_version_and_planning_prompt_describe_the_loan_panel_flow():
    assert prompts.PLANNING_VERSION == "planning-2.4"
    text = " ".join(prompts.PLANNING.split())
    for removed in ("confirm_plan", "confirm_enrollment", "record_expense", "get_spending", "available_funds",
                    "support_amount", "prequal", "ENROLLED", "funding gap", "monthly budget"):
        assert removed not in text, removed
    assert "principal" in text and "simulate_loan" in text and "admission notice" in text


def test_missing_data_is_stated_once_with_a_source_and_an_offer_never_a_question():
    # Observed live (planning-2.2): "那个大学排名更高" -> "QS or THE, which year?" -> "qs" -> "which year?" ...
    text = " ".join(prompts.PLANNING.split())
    for phrase in ("memory.data_coverage", "without calling a tool", "school's website",
                   "Never ask which list, year, edition or source", "never ask the user to supply the data",
                   "memory.funnel.invite"):
        assert phrase in text, phrase


def test_no_role_is_needed_and_prices_come_first():
    assert step("朱拉隆功贵吗").tool == "estimate_total_cost"
    assert args(step("朱拉隆功读4年一共多少钱？")) == {"school_key": "chulalongkorn", "years": 4}
    # Saying who you are is neither required nor asked; the catalog is shown with prices.
    assert step("我是家长，孩子明年出国，有哪些学校").tool == "list_schools"
    for goal, locale in [("你好", "zh"), ("hello", "en")]:
        result = step(goal, locale=locale)
        assert isinstance(result, FinalStep)
        assert "家长" not in result.answer and "parent" not in result.answer.lower()
        assert "存款" not in result.answer and "savings" not in result.answer.lower()


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
    # The card lists each school; the reply names the cheapest and the gap, then invites a choice.
    assert "最低的是朱拉隆功大学，比最贵的一所少约 500,000 THB" in answer
    assert answer.endswith(funnel.invite("choose", "zh"))


def test_country_filter_and_comparison():
    assert args(step("日本有什么学校")) == {"country_code": "JP"}
    assert args(step("比较早稻田和朱拉隆功")) == {"school_keys": ["waseda", "chulalongkorn"]}


def test_choosing_a_school_saves_the_plan_without_savings():
    result = step("我们有存款30万人民币，就选早稻田")
    assert result.tool == "save_plan"
    assert args(result) == {"school_key": "waseda"}


def test_a_loan_amount_said_in_chat_goes_to_save_plan_principal():
    result = step("就选早稻田，想借30万泰铢")
    assert result.tool == "save_plan"
    assert args(result) == {"school_key": "waseda", "principal": "300000.00", "principal_currency": "THB"}
    english = step("Go with Waseda for 4 years, we want to borrow 500,000 THB", locale="en")
    assert args(english) == {"school_key": "waseda", "years": 4, "principal": "500000.00",
                             "principal_currency": "THB"}
    # A stated amount for an existing plan is saved too; a term is not an amount.
    assert args(step("贷款20万泰铢", plan=DRAFT)) == {"principal": "200000.00",
                                                     "principal_currency": "THB"}
    assert args(step("帮我贷款，分36个月", plan=DRAFT)) == {"months": 36}


def test_ambiguous_loan_amount_is_asked_once():
    result = step("想借20万泰铢，或者借款30万泰铢", plan=DRAFT)
    assert isinstance(result, FinalStep) and "借款金额" in result.answer and result.answer.count("？") == 1


def test_after_choosing_a_school_the_reply_asks_how_much_to_borrow():
    result = step("就选早稻田", observations=[saved()])
    assert result.tool == "simulate_loan"
    opened = Observation(tool="simulate_loan", status="OK", arguments={}, result={
        **saved().result, "open_assessment": True})
    answer = step("就选早稻田", observations=[saved(), opened]).answer
    assert answer.endswith(funnel.invite("amount", "zh")) and "贷款面板" not in answer
    assert "缺口" not in answer and "存款" not in answer


def test_a_stored_loan_amount_is_repeated_in_the_reply():
    def stored(arguments, principal):
        result = saved().result | {"loan_principal": principal}
        return Observation(tool="save_plan", status="OK", arguments={"school_key": "waseda", **arguments}, result=result)

    def opened(observation):
        return Observation(tool="simulate_loan", status="OK", arguments={},
                           result={**observation.result, "open_assessment": True})

    thb = stored({"principal": "200000.00", "principal_currency": "THB"}, "200000.00")
    answer = step("贷款20万泰铢", plan=DRAFT, observations=[thb, opened(thb)]).answer
    assert "想借的 200,000 THB 我记下了" in answer and "告诉我想借多少" not in answer
    # An amount said in another currency is repeated as stored (THB) and as said.
    cny = stored({"principal": "50000.00", "principal_currency": "CNY"}, "245000.00")
    english = step("We want to borrow 50,000 CNY", plan=DRAFT, locale="en", observations=[cny, opened(cny)]).answer
    assert "the 245,000 THB (converted from 50,000 CNY) you'd like to borrow" in english
    # Without a stored amount the reply asks for it.
    plain = step("就选早稻田", observations=[saved(), opened(saved())]).answer
    assert "告诉我想借多少" in plain and "我记下了" not in plain


def test_loan_needs_a_school_first():
    asks = step("帮我贷款")
    assert isinstance(asks, FinalStep) and "先选定学校" in asks.answer
    assert asks.answer.endswith(funnel.invite("price", "zh"))
    assert "存款" not in asks.answer and "缺口" not in asks.answer
    assert args(step("帮我贷款，分36个月", plan=DRAFT)) == {"months": 36}


def test_finalising_a_draft_opens_the_loan_panel_instead_of_confirming_in_chat():
    for goal, locale in [("确认计划", "zh"), ("I want to finalise the plan", "en")]:
        result = step(goal, plan=DRAFT, locale=locale)
        assert result.tool == "simulate_loan", (goal, result)
    english = step("Confirm my plan", plan=DRAFT, locale="en", observations=[Observation(
        tool="simulate_loan", status="OK", arguments={}, result={**saved().result, "open_assessment": True})])
    assert english.answer.endswith(funnel.invite("amount", "en"))


def test_removed_tools_are_never_called():
    tools = PLANNING_TOOLS + sorted(REMOVED_TOOLS)
    for plan in (None, DRAFT, CONFIRMED):
        for goal in ["确认计划", "孩子已经到校报到了", "我已完成报到", "I have enrolled", "今天午饭花了120泰铢",
                     "这个月花了多少？", "打车花了85泰铢", "What did I spend this month?", "首月预算"]:
            result = step(goal, plan=plan, tools=tools)
            assert getattr(result, "tool", None) not in REMOVED_TOOLS, (goal, plan, result)


def test_spending_is_not_recorded():
    for goal, locale in [("今天午饭花了120泰铢", "zh"), ("I spent 85 THB on a taxi", "en")]:
        result = step(goal, plan=CONFIRMED, locale=locale)
        assert isinstance(result, FinalStep), (goal, result)
        assert "不做记录" in result.answer or "isn't tracked" in result.answer


def test_answers_only_quote_numbers_from_observations():
    estimate = Observation(tool="estimate_total_cost", status="OK", arguments={"school_key": "waseda"}, result={
        "currency": "JPY", "years": 4, "total": "9000000.00", "total_low": "8000000.00", "total_high": "9900000.00",
        "estimated_share": "31.4", "groups": {"tuition": "6000000.00", "living": "2500000.00",
                                              "essentials": "500000.00"}})
    answer = step("早稻田全部费用", observations=[estimate]).answer
    assert "9,000,000 JPY" in answer and "6,000,000 JPY" in answer and "示例数据" in answer
    assert answer.endswith(funnel.invite("compare", "zh"))


def test_confirmed_plans_ask_for_bills_and_reach_the_finance_rules():
    assert step("接下来有哪些账单", plan=CONFIRMED).tool == "list_bills"
    assert step("人民币兑泰铢汇率是多少", plan=CONFIRMED).tool == "get_fx_rate"
    assert step("我的余额是多少", plan=CONFIRMED).tool == "get_balances"
    assert step("把1000人民币换成泰铢", plan=CONFIRMED).tool == "get_balances"


def test_money_tools_wait_for_the_loan_application():
    for plan in (None, DRAFT):
        for goal in ["人民币兑泰铢汇率是多少", "我的余额是多少", "把1000人民币换成泰铢", "汇款5000泰铢给学校"]:
            result = step(goal, plan=plan)
            assert isinstance(result, FinalStep), (goal, plan, result)
            assert "贷款申请提交后才会开放" in result.answer and "入学" not in result.answer
    english = step("What is my balance?", locale="en")
    assert isinstance(english, FinalStep) and "once your loan application is submitted" in english.answer
    assert "enrollment" not in english.answer
    # Planning questions that merely mention status are not wallet requests.
    assert step("我的计划进度").tool == "get_plan"
    # Loans stay available before the application.
    assert step("帮我贷款，分36个月", plan=DRAFT).tool == "simulate_loan"


def test_the_on_time_record_is_not_offered_in_planning_chat():
    for plan in (DRAFT, CONFIRMED):
        result = step("我的信用记录怎么样", plan=plan)
        assert getattr(result, "tool", None) != "get_credit_profile"


def test_submitted_application_is_not_reopened_from_chat():
    result = step("帮我贷款", plan=CONFIRMED)
    assert isinstance(result, FinalStep) and "贷款申请已经提交好了" in result.answer
    assert "提交好了" in step("确认", plan=CONFIRMED).answer


def test_preparation_topics_are_read_only_and_campus_questions_stay_available():
    assert isinstance(step("出发准备"), FinalStep)
    for goal in ["出发准备", "首月预算", "Departure preparation", "First-month budget", "日期有变化",
                 "My start date has changed"]:
        result = step(goal, plan=CONFIRMED)
        assert isinstance(result, FinalStep), (goal, result)
        assert "入学" not in result.answer and "enrollment" not in result.answer.lower()
    first_month = {"currency": "JPY", "first_month_total": "300000", "monthly_total": "150000",
                   "one_off_total": "150000", "bills_at_start_total": "900000"}
    answer = step("首月预算", plan={**CONFIRMED, "first_month": first_month}).answer
    assert "300,000 JPY" in answer and "本月" not in answer
    assert step("学校周边有什么好吃的？", plan=CONFIRMED).tool == "get_school_profile"
    assert args(step("What food is near my school?", plan=CONFIRMED,
                     recent_schools=["chulalongkorn"])) == {"school_key": "waseda"}
