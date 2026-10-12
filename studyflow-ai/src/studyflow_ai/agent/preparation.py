"""Read-only preparation guidance and conservative arrival intent for the mock planner."""

import re


def arrival_reported(text):
    if any(word in text for word in ("没", "未", "明天", "将", "准备", "如何", "怎么", "是否", "吗", "?", "？")):
        return False
    if re.search(r"\b(not|never|tomorrow|will|how|when|whether)\b|haven't|hasn't|isn't", text):
        return False
    return any(word in text for word in ("已入学", "已经入学", "入学了", "已完成报到", "已经报到", "报到了", "已经到校",
        "i have enrolled", "i'm enrolled", "i am enrolled", "i have arrived", "i've arrived", "i'm on campus",
        "completed registration", "has enrolled", "has arrived"))


def preparation_reply(text, status, locale):
    if any(word in text for word in ("日期有变化", "延期", "推迟", "start date has changed", "postpone", "defer")):
        pair = ("先不确认入学。新的开学日期是什么，是否已得到学校确认？目前我还不能修改计划日期；这条消息不会改变计划、账单或还款日期。",
                "Let's hold off on enrollment. What is the new start date, and has the school confirmed it? I cannot update the plan date yet; this message changes no plan, bill or repayment dates.")
    elif any(word in text for word in ("还在准备", "还没报到", "还没入学", "尚未报到", "尚未入学", "未入学", "still preparing", "not arrived", "not enrolled", "haven't arrived", "明天去报到", "how do i enroll")):
        pair = ("明白，先继续准备，不会据此确认入学。你现在最需要处理住宿、出发安排，还是首月预算？完成报到后再告诉我。",
                "Understood. We can continue preparing; I will not confirm enrollment from this. Would housing, departure preparation or the first-month budget help most? Tell me once registration is complete.")
    elif any(word in text for word in ("出发准备", "departure preparation")):
        pair = ("可以先梳理录取与报到材料、旅行证件、到达交通和首晚住宿。具体要求与日期需要向学校核实。你已经获得录取了吗，预计什么时候出发？这里只讨论准备事项，不代表已订票或完成手续。",
                "Let's review admission and registration documents, travel documents, arrival transport and the first night's accommodation. Verify requirements and dates with the school. Do you have an offer, and when do you expect to travel? This discussion does not book travel or complete any process.")
    elif status != "ENROLLED" and any(word in text for word in ("首月预算", "first-month budget")):
        pair = ("首月预算需要区分一次性开支和每月开支：住宿押金、安置用品，以及房租、吃饭和交通。先从学校费用示例核对，再用已确认的实际金额完善；目前没有生成新预算或账单。住宿是否已确定，有没有押金金额？",
                "Separate one-off arrival costs from recurring costs: housing deposit and setup items, then rent, food and transport. Check the school's sample costs before using confirmed actual amounts. No new budget or bill has been created. Have you arranged housing, and do you know the deposit?")
    elif status == "CONFIRMED" and text.strip() in ("确认", "confirm"):
        pair = ("你是想继续准备，还是已经完成报到？确认留学计划不代表录取或入学；完成报到后才能确认进入日常生活阶段。",
                "Do you want to continue preparing, or have you completed registration? Confirming a study plan does not mean admission or enrollment. Confirm enrollment after registration.")
    else:
        return None
    return pair[0 if locale == "zh" else 1]
