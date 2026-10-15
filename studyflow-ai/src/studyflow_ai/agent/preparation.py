"""Read-only preparation guidance for the mock planner."""


def _money(value, currency):
    return f"{float(value):,.0f} {currency}"


def first_month_reply(month):
    """The first month after arrival from the plan's sample costs, in plain words."""
    c = month["currency"]
    zh = (f"按学校费用示例估算，到校第一个月大约需要 {_money(month['first_month_total'], c)}："
          f"每月吃饭、交通、通讯约 {_money(month['monthly_total'], c)}，"
          f"加上押金、签证、安家等一次性开支约 {_money(month['one_off_total'], c)}。"
          f"开学时到期的学费、住宿、保险等账单约 {_money(month['bills_at_start_total'], c)}，会作为计划账单单独列出，不用重复准备。"
          "住宿已经定好了吗？确定后可以按实际押金再调整。")
    en = (f"From the school's sample costs, the first month after arrival needs about {_money(month['first_month_total'], c)}: "
          f"about {_money(month['monthly_total'], c)} a month for food, transport and phone, plus about "
          f"{_money(month['one_off_total'], c)} once for the deposit, visa and settling in. The tuition, housing and insurance bills "
          f"due at the start (about {_money(month['bills_at_start_total'], c)}) are listed separately as plan bills. "
          "Is your housing arranged? We can adjust with the actual deposit.")
    return zh, en


def preparation_reply(text, status, locale, plan=None):
    if any(word in text for word in ("日期有变化", "延期", "推迟", "start date has changed", "postpone", "defer")):
        pair = ("新的开学日期是什么，是否已得到学校确认？目前我还不能修改计划日期；这条消息不会改变计划、账单或还款日期。",
                "What is the new start date, and has the school confirmed it? I cannot update the plan date yet; this message changes no plan, bill or repayment dates.")
    elif any(word in text for word in ("出发准备", "departure preparation")):
        pair = ("可以先梳理录取与报到材料、旅行证件、到达交通和首晚住宿。具体要求与日期需要向学校核实。你已经获得录取了吗，预计什么时候出发？这里只讨论准备事项，不代表已订票或完成手续。",
                "Let's review admission and registration documents, travel documents, arrival transport and the first night's accommodation. Verify requirements and dates with the school. Do you have an offer, and when do you expect to travel? This discussion does not book travel or complete any process.")
    elif any(word in text for word in ("首月预算", "首月开支", "first-month budget", "first-month costs")) and (plan or {}).get("first_month"):
        pair = first_month_reply(plan["first_month"])
    elif any(word in text for word in ("首月预算", "首月开支", "first-month budget", "first-month costs")):
        pair = ("首月开支需要区分一次性开支和每月开支：住宿押金、安置用品，以及房租、吃饭和交通。先从学校费用示例核对，再用已确认的实际金额完善；这段对话不会生成预算或账单。住宿是否已确定，有没有押金金额？",
                "Separate one-off arrival costs from recurring costs: housing deposit and setup items, then rent, food and transport. Check the school's sample costs before using confirmed actual amounts. This conversation creates no budget or bill. Have you arranged housing, and do you know the deposit?")
    elif status == "CONFIRMED" and text.strip() in ("确认", "confirm"):
        pair = ("计划已确认，贷款申请已提交。接下来在待办里确认其余材料并签约；需要的话我可以查看账单或帮你换汇、汇款。",
                "Your plan is confirmed and the loan application is submitted. Next, confirm the other documents and sign in your to-dos; I can also show bills or help exchange and send money.")
    else:
        return None
    return pair[0 if locale == "zh" else 1]
