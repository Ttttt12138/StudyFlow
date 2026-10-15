"""Loan-stage intents and concise, source-backed replies for the deterministic planner."""
import re
from decimal import Decimal

from .planning_facts import CODES, CURRENCY, NUMBER

INTENTS = {
    "pause": ("不考虑贷款", "暂时不考虑", "不要推荐", "不需要贷款", "不贷款", "先不借", "不想贷款",
              "not interested", "stop recommending", "no loan", "don't want a loan"),
    "resume": ("继续推荐", "再看看贷款", "resume", "recommend again"),
    "reduce_amount": ("借这么多", "借太多", "少借", "减少金额", "降低金额", "borrow less", "too much to borrow", "reduce the amount"),
    "lower_monthly": ("月供太高", "月供有点高", "月供低", "降低月供", "每月还太多", "还款压力", "monthly payment is too high",
                      "lower monthly", "monthly payment too high", "monthly payments are too high"),
    "lower_interest": ("多付利息", "利息太高", "利息太多", "少付利息", "降低利息", "less interest", "lower interest", "too much interest"),
    "apply": ("按这个方案", "按此方案", "帮我申请", "开始申请", "确认申请", "我要申请", "apply", "go ahead", "looks good"),
}


def intent(message):
    for key, phrases in INTENTS.items():
        if any(phrase in message.text for phrase in phrases):
            return key
    if message.text.strip(" 。.!！") in ("确认", "就这样", "好的", "confirm", "yes", "ok") and (
            message.plan or {}).get("loan_advice", {}).get("status") == "recommended":
        return "apply"
    return None


def amount_reply(message):
    advice = (message.plan or {}).get("loan_advice") or {}
    if advice.get("status") != "needs_amount":
        return {}
    found = re.fullmatch(rf"\s*({CURRENCY})?\s*{NUMBER}\s*({CURRENCY})?\s*[。.!！]?", message.text, re.I)
    if not found:
        return {}
    factor = {"万": 10000, "千": 1000, "k": 1000}.get((found.group(3) or "").lower(), 1)
    currency = found.group(1) or found.group(4)
    if found.group(1) and found.group(4) and CODES.get(found.group(1), found.group(1).upper()) != CODES.get(found.group(4), found.group(4).upper()):
        return {}
    return {"principal": format(Decimal(found.group(2).replace(",", "")) * factor, ".2f"),
            **({"principal_currency": CODES.get(currency, currency.upper())} if currency else {})}


def relevant(message):
    if not message.plan:
        return False
    terms = ("只还利息", "先息后本", "等额本息", "interest only", "interest-only", "amortized")
    return bool(intent(message) or amount_reply(message) or message.months
                or any(word in message.text for word in terms))


def arguments(message):
    request = dict(message.facts) or amount_reply(message)
    wanted = intent(message)
    if wanted:
        request["intent"] = wanted
    if message.months:
        request["months"] = message.months
    if any(word in message.text for word in ("只还利息", "先息后本", "interest only", "interest-only")):
        request["method"] = "interest_only"
    elif any(word in message.text for word in ("等额本息", "amortized")):
        request["method"] = "amortized"
    if any(word in message.text for word in ("自定义", "custom")):
        request["product"] = "custom"
    elif any(word in message.text for word in ("商业留学", "commercial study")):
        request["product"] = "commercial_student_demo"
    return request


def _cash(value):
    return f"{Decimal(str(value)):,.2f} THB"


def _name(product, locale):
    names = {"commercial_student_demo": ("商业留学贷款示例", "commercial study loan example"),
             "custom": ("自定义贷款示例", "custom loan example")}
    return names[product][0 if locale == "zh" else 1]


def _changes(change, locale):
    if not change:
        return ""
    labels = (("monthly_payment", "月供", "Monthly payment"), ("total_interest", "总利息", "total interest"))
    pieces = []
    for key, zh, en in labels:
        value = Decimal(change[key])
        direction = ("减少" if value < 0 else "增加") if locale == "zh" else ("decreases by" if value < 0 else "increases by")
        if value:
            pieces.append(f"{zh}{direction}{_cash(abs(value))}" if locale == "zh" else f"{en} {direction} {_cash(abs(value))}")
    return (("与上一方案相比，" + "，".join(pieces) + "。") if locale == "zh"
            else "Compared with the previous plan: " + "; ".join(pieces) + ". ") if pieces else ""


def advice_reply(advice, locale):
    zh = locale == "zh"
    status = advice["status"]
    if status == "paused":
        return "好的，已暂停贷款推荐。需要时告诉我继续即可。" if zh else "Loan recommendations are paused. Tell me when you want to resume."
    if status == "submitted":
        return ("贷款申请已提交，接下来核对其余材料并签约。所有贷款与资金均为模拟。" if zh else
                "Your loan application is submitted. Review the remaining documents, then sign. All loans and funds are simulated.")
    if status == "needs_amount":
        if advice.get("intent") == "reduce_amount":
            return "可以减少借款。你想把贷款金额调整到多少？原方案保留，我会重新测算月供和总利息。" if zh else "We can reduce the amount. How much would you like to borrow? I'll recalculate the monthly payment and total interest."
        product = advice["product"]
        rate = (Decimal(product["annual_rate"]) * 100).normalize()
        return (f"我推荐先看{_name(product['key'], locale)}，当前示例年利率 {rate:g}%，支持分期还款。"
                "你希望借多少？告诉我金额，我会选出一个方案，列明月供和全部费用，再带你提交贷款申请。所有贷款均为模拟。" if zh else
                f"I recommend starting with the {_name(product['key'], locale)} at {rate:g}% annual interest. "
                "How much would you like to borrow? I'll prepare a plan with monthly payments and all costs, then guide you to apply. Loans are simulated.")
    return _recommended_reply(advice, locale)


def _recommended_reply(advice, locale):
    row = advice["selected"]
    zh = locale == "zh"
    name, rate = _name(row["product"], locale), (Decimal(row["annual_rate"]) * 100).normalize()
    reason = {"lower_monthly": ("优先降低月供", "to lower the monthly payment"),
              "lower_interest": ("优先减少总利息", "to reduce total interest"),
              "reduce_amount": ("按你调整的金额", "for your updated amount")}.get(advice.get("intent"),
                 ("按当前产品费用比较", "based on the available product costs"))[0 if zh else 1]
    intro = (f"{reason}，推荐{name}：借款 {_cash(row['principal'])}，{row['months']} 期，年利率 {rate:g}%。"
             f"月供最高 {_cash(row['monthly_payment'])}，总利息 {_cash(row['total_interest'])}，"
             f"手续费 {_cash(row['fees'])}，总还款 {_cash(row['total_repayment'])}。" if zh else
             f"I recommend the {name} {reason}: {_cash(row['principal'])}, {row['months']} installments at {rate:g}% annually. "
             f"Monthly payment up to {_cash(row['monthly_payment'])}; interest {_cash(row['total_interest'])}; "
             f"fees {_cash(row['fees'])}; total repayment {_cash(row['total_repayment'])}. ")
    if row.get("interest_only_months"):
        intro += (f"在校期间先付息 {row['interest_only_months']} 个月，每月最高 {_cash(row['interest_only_payment'])}，之后再还上述本金分期。" if zh else
                  f"First, {row['interest_only_months']} interest-only months up to {_cash(row['interest_only_payment'])}, followed by those installments. ")
    next_step = ("点击「按此方案申请」核对并提交贷款申请；提交时会附上模拟录取通知。" if zh else
                 "Choose Apply with this plan to review and submit; a simulated admission notice is attached on submission. ")
    return intro + _changes(advice.get("change"), locale) + next_step + ("所有贷款均为模拟。" if zh else "All loans are simulated.")
