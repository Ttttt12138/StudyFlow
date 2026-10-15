"""Where the user is in the core flow, and the one invitation that moves them to the next step.

price -> compare -> choose -> amount -> apply -> applied. A paused loan recommendation stays paused:
the invitation goes back to schools instead of loans. Every reply (the model's and the templates')
ends with this invitation, so the conversation keeps moving toward the next step.
"""

INVITES = {
    "price": ("想去哪所学校或哪个国家？告诉我，我先帮你算算读完一共要多少钱。",
              "Which school or country do you have in mind? Tell me and I'll work out what the whole programme costs."),
    "compare": ("要不要再挑一所放在一起比比？如果就是它了，点卡片上的「选这所」就行。",
                "Want to put another school next to it? If this is the one, just tap “Choose” on its card."),
    "choose": ("看下来哪所最合心意？点它卡片上的「选这所」，我们接着看贷款方案。",
               "Which one feels right? Tap “Choose” on its card and we'll look at loan options next."),
    "amount": ("如果钱还差一些，告诉我想借多少，我帮你挑方案、算清月供。",
               "If you're still short, tell me how much you'd like to borrow and I'll find a plan and work out the "
               "monthly payment."),
    "apply": ("这个方案合适的话，点「按此方案申请」就行；觉得月供或利息高了，也可以直接告诉我。",
              "If this plan works for you, tap “Apply with this plan”; if the monthly payment or interest feels "
              "high, just tell me."),
    "applied": ("接下来在待办里核对材料、完成签约就好；之后要换汇或给学校汇款，也可以找我。",
                "Next, check the documents in your to-dos and sign. When you need to exchange or send money to the "
                "school, I'm here."),
    "paused": ("还想再比比别的学校吗？说个名字，我帮你算全程总价。",
               "Want to compare a few more schools? Name one and I'll work out its full cost."),
}
STAGES = tuple(INVITES)
ADVICE_STAGE = {"recommended": "apply", "needs_amount": "amount", "paused": "paused", "submitted": "applied"}
DISCLOSURE = {"zh": "温馨提示：这里的贷款和资金都是模拟的。", "en": "Just so you know: loans and money here are simulated."}


def base_stage(memory):
    """The stage from server facts at the start of a turn: memory.plan, and the schools named
    (recent_schools) or shown on price cards (shown_schools) in recent turns."""
    memory = memory or {}
    plan = memory.get("plan") or {}
    if plan.get("status") == "CONFIRMED":
        return "applied"
    if plan.get("status") == "DRAFT":
        return ADVICE_STAGE.get((plan.get("loan_advice") or {}).get("status"), "amount")
    seen = len({*(memory.get("recent_schools") or []), *(memory.get("shown_schools") or [])})
    return "price" if seen == 0 else "compare" if seen == 1 else "choose"


def stage(memory, observations=()):
    """The stage after this turn's tool results, e.g. a school list moves price -> choose."""
    current = base_stage(memory)
    for item in observations:
        if item.status != "OK":
            continue
        result = item.result or {}
        if item.tool == "simulate_loan" and result.get("advice"):
            current = ADVICE_STAGE.get(result["advice"].get("status"), current)
        elif item.tool == "save_plan" and result.get("plan"):
            current = "applied" if result["plan"].get("status") == "CONFIRMED" else "amount"
        elif current in ("price", "compare") and item.tool in ("list_schools", "compare_schools"):
            current = "choose" if len(result.get("schools") or []) > 1 else "compare"
        elif current == "price" and item.tool in ("estimate_total_cost", "get_school_profile"):
            current = "compare"
    return current


def invite(stage_name, locale):
    zh, en = INVITES.get(stage_name, INVITES["price"])
    return zh if locale == "zh" else en
