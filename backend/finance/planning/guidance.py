"""Server-authored handoffs after an actual plan transition; no model or money operation."""
from studyflow_ai.agent.funnel import invite

HANDOFFS = {
    "CONFIRMED": {
        "zh": "你的方案和贷款申请都提交好了，模拟录取通知也一并附上。待办、账单和钱包现在都开放了。"
              + invite("applied", "zh"),
        "en": "Your plan and loan application are in, with a simulated admission notice attached. To-dos, bills "
              "and the wallet are open now. " + invite("applied", "en"),
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


def advance_after_choice(session, observation, number):
    """Choosing a school in words continues to the loan recommendation, as the price card's button does.

    Observed live (planning-2.4): after save_plan the model often answered without simulate_loan, so no
    loan card appeared and the flow stalled. The recommendation is the system's next step, not the model's.
    """
    if not session.conversation_id or observation.tool != "save_plan" or observation.status != "OK":
        return False
    plan = observation.result.get("plan") or {}
    if plan.get("status") != "DRAFT":
        return False
    from types import SimpleNamespace

    from studyflow_ai.agent.funnel import invite
    from studyflow_ai.agent.loan_rules import advice_reply

    from finance import agent_runner
    from finance.agent_models import AgentStep

    from .conversation import CHOSEN

    step = SimpleNamespace(tool="simulate_loan", rationale="Recommend after choosing a school", arguments_json="{}")
    advice = agent_runner._execute(session, number + 1, step, {"provider": "system", "purpose": "loan_advice"}, {})
    result = (advice.result or {}).get("advice") if advice.status == "OK" else None
    locale = session.locale
    name = ((plan.get("school") or {}).get("name") or {}).get(locale) or plan.get("school_key")
    chosen = CHOSEN[locale][1].format(name=name, years=f"{plan['duration_months'] / 12:g}", currency=plan["currency"],
                                      total=f"{float(plan['total']):,.0f}")
    if result and result.get("status") != "paused":
        reply = advice_reply(result, locale)
    else:
        reply = invite("paused" if result else "amount", locale)
    session.status, session.final_answer = "COMPLETED", chosen + reply
    AgentStep.objects.create(owner=session.owner, session=session, number=number + 2, status="FINAL",
        result={"answer": session.final_answer}, call={"provider": "system", "purpose": "loan_advice_reply",
                                                     "mode": "deterministic"})
    return True


def finish_loan_advice(session, observation, number):
    """One completed calculation has one authoritative reply, without another model/tool cycle."""
    if not session.conversation_id or observation.tool != "simulate_loan" or observation.status != "OK":
        return False
    advice = observation.result.get("advice")
    if not advice:
        return False
    from studyflow_ai.agent.loan_rules import advice_reply

    from finance.agent_models import AgentStep

    session.status, session.final_answer = "COMPLETED", advice_reply(advice, session.locale)
    AgentStep.objects.create(owner=session.owner, session=session, number=number + 1, status="FINAL",
        result={"answer": session.final_answer}, call={"provider": "system", "purpose": "loan_advice_reply",
                                                     "mode": "deterministic"})
    return True
