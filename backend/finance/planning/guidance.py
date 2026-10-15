"""Server-authored handoffs after an actual plan transition; no model or money operation."""

HANDOFFS = {
    "CONFIRMED": {
        "zh": "方案和模拟贷款申请已提交，模拟录取通知已自动附加。请核对其余材料后签约；待办、账单和钱包现已开放。所有资金均为模拟。",
        "en": "Your plan and simulated loan application are submitted. A simulated admission notice is attached automatically. Check the remaining documents before signing. To-dos, bills and the wallet are now available; all funds are simulated.",
    },
}


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
