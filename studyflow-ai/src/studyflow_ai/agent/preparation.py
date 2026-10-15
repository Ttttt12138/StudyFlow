"""Read-only preparation guidance for the mock planner."""
from .funnel import invite


def _money(value, currency):
    return f"{float(value):,.0f} {currency}"


def first_month_reply(month):
    """The first month after arrival from the plan's sample costs, in plain words."""
    c = month["currency"]
    zh = (f"按学校的费用示例算，到校第一个月大约要准备 {_money(month['first_month_total'], c)}："
          f"每月吃饭、交通、通讯约 {_money(month['monthly_total'], c)}，"
          f"加上押金、签证、安家等一次性开支约 {_money(month['one_off_total'], c)}。"
          f"开学时要交的学费、住宿、保险等约 {_money(month['bills_at_start_total'], c)}，已经单独列在账单里，不用重复准备。"
          "住宿定好了吗？定了的话可以按实际押金再调一调。")
    en = (f"From the school's sample costs, the first month after arrival needs about {_money(month['first_month_total'], c)}: "
          f"about {_money(month['monthly_total'], c)} a month for food, transport and phone, plus about "
          f"{_money(month['one_off_total'], c)} once for the deposit, visa and settling in. The tuition, housing and insurance bills "
          f"due at the start (about {_money(month['bills_at_start_total'], c)}) are listed separately as plan bills. "
          "Is your housing arranged? We can adjust with the actual deposit.")
    return zh, en


def preparation_reply(text, status, locale, plan=None):
    if any(word in text for word in ("日期有变化", "延期", "推迟", "start date has changed", "postpone", "defer")):
        pair = ("开学日期有变化呀。新的日期是哪天，学校确认了吗？这里暂时还改不了方案里的日期，账单和还款日期也会先保持不变。",
                "Your start date changed? What's the new date, and has the school confirmed it? I can't change the plan date here yet, so bills and repayment dates stay as they are for now.")
    elif any(word in text for word in ("出发准备", "departure preparation")):
        pair = ("出发前可以先把这几样理一理：录取和报到材料、护照签证、落地后的交通，还有第一晚住哪儿。具体要求和日期以学校通知为准。你打算什么时候出发？",
                "Before you leave, it helps to sort out a few things: admission and registration documents, passport and visa, getting from the airport, and where you'll stay the first night. Go by the school's notices for exact requirements and dates. When are you planning to fly out?")
    elif any(word in text for word in ("首月预算", "首月开支", "first-month budget", "first-month costs")) and (plan or {}).get("first_month"):
        pair = first_month_reply(plan["first_month"])
    elif any(word in text for word in ("首月预算", "首月开支", "first-month budget", "first-month costs")):
        pair = ("首月的钱可以分两块看：一次性的（住宿押金、安家用品）和每月都有的（房租、吃饭、交通）。先参考学校的费用示例，等实际金额定了再细调。住宿定下来了吗？",
                "Think of the first month in two parts: one-off costs (housing deposit, setting up) and monthly ones (rent, food, transport). Start from the school's sample costs and adjust once the real amounts are known. Have you sorted out housing?")
    elif status == "CONFIRMED" and text.strip() in ("确认", "confirm"):
        pair = ("你的方案和贷款申请都已经提交好了。" + invite("applied", "zh"),
                "Your plan and loan application are both in. " + invite("applied", "en"))
    else:
        return None
    return pair[0 if locale == "zh" else 1]
