"""Server-authored handoffs after an actual plan transition; no model or money operation."""

HANDOFFS = {
    "CONFIRMED": {
        "zh": "留学计划已保存，接下来一起准备入学。确认计划不代表已录取：你目前是在等待录取、已获录取，还是准备出发？我们可以先聊住宿安排、出发准备或首月预算，之后仍可继续咨询学校。",
        "en": "Your study plan is saved. Let's start preparing for enrollment. A confirmed plan is not an admission offer: are you awaiting an offer, holding an offer, or preparing to travel? We can discuss housing, departure preparation or your first-month budget. School questions are still welcome.",
    },
    "ENROLLED": {
        "zh": "已根据你的确认进入日常生活阶段，计划中的模拟账单已生成。可以先看看本月预算、记一笔开销，或者聊聊校园周边。你想从哪里开始？确认入学没有支付任何账单，所有资金仍为模拟。",
        "en": "Enrollment is confirmed: let's settle into daily life. Your planned simulated bills are ready. Start with this month's budget, record an expense, or explore campus life. What would help first? Confirming enrollment has not paid any bill; all funds remain simulated.",
    },
}


def append_handoff(pending):
    from finance.agent_models import AgentSession

    conversation = pending.session.conversation
    if conversation is None:
        return
    status = "CONFIRMED" if pending.action == "plan.confirm" else "ENROLLED"
    AgentSession.objects.get_or_create(
        owner=pending.owner, idempotency_key=f"handoff:{pending.id}",
        defaults={"conversation": conversation, "goal": "", "locale": conversation.locale,
                  "mode": "system", "status": "COMPLETED",
                  "final_answer": HANDOFFS[status][conversation.locale], "cards": []})


def append_confirmed(user, plan):
    """The same handoff when the plan is confirmed in the panel, in the student's most recent conversation."""
    from finance.agent_models import AgentSession

    from .models import AgentConversation

    conversation = AgentConversation.objects.filter(owner=user).order_by("-updated_at").first()
    if conversation is None:
        return
    AgentSession.objects.get_or_create(
        owner=user, idempotency_key=f"handoff:plan:{plan.id}:{plan.version}",
        defaults={"conversation": conversation, "goal": "", "locale": conversation.locale,
                  "mode": "system", "status": "COMPLETED",
                  "final_answer": HANDOFFS["CONFIRMED"][conversation.locale], "cards": []})
