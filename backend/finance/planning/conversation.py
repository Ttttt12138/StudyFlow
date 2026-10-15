"""Multi-turn planning conversations on top of the single-goal agent loop (finance/agent_runner.py).

Each user message becomes one AgentSession (a turn) linked to the conversation. The planner gets
the earlier turns as history and server facts as memory. Assistant-initiated turns (greeting,
enrollment proposal) have an empty goal and never call a model.
"""

from types import SimpleNamespace

from django.conf import settings
from django.db import transaction

from finance import agent_runner
from finance.agent_models import AgentSession
from finance.services import json_value
from finance.workflow_common import record, require

from . import catalog, services
from .models import AgentConversation

HISTORY_TURNS = 12


def _memory(conversation):
    user = conversation.owner
    plan = services.plan_for(user)
    plan_info = None
    if plan is not None:
        full = services.plan_record(plan, services.home_currency(user))["plan"]
        plan_info = {k: full.get(k) for k in ("status", "school_key", "years", "start_date", "total",
                                              "currency")}
        plan_info["has_loan"] = plan.loan_id is not None
        from .assessment import latest, current_inputs
        assessment = latest(plan)
        if assessment:
            plan_info["known_planning_inputs"] = current_inputs(assessment.inputs, user, plan)
            plan_info["loan_advice"] = {k: v for k, v in assessment.result.get("loan_advice", {}).items()
                                        if k in ("status", "intent")}
    recent = []
    for turn in conversation.turns.order_by("-created_at")[:6]:
        for step in turn.steps.order_by("-number"):
            for key in [step.arguments.get("school_key"), *(step.arguments.get("school_keys") or [])]:
                if key and key not in recent:
                    recent.append(key)
    return {
        "home_currency": services.home_currency(user),
        "today": services.today_for(user).isoformat(),
        "plan": plan_info,
        "recent_schools": recent[:4],
        "schools": [{"key": e.key, "name_en": e.school.name.en, "name_zh": e.school.name.zh,
                     "country_code": e.school.country_code, "country_en": e.school.country.en,
                     "country_zh": e.school.country.zh} for e in catalog.schools()],
    }


def turn_record(turn):
    data = agent_runner.session_record(turn)
    data["kind"] = "user" if turn.goal else "assistant"
    return data


def conversation_record(conversation):
    profile = services.profile(conversation.owner)
    return {"id": str(conversation.id), "locale": conversation.locale,
            "created_at": conversation.created_at.isoformat(), "updated_at": conversation.updated_at.isoformat(),
            "profile": services.profile_record(profile),
            "plan": services.plan_record(services.plan_for(conversation.owner),
                                         services.home_currency(conversation.owner))["plan"],
            "turns": [turn_record(t) for t in conversation.turns.order_by("created_at")],
            "is_simulated": True}


def _assistant_turn(conversation, text, cards=None):
    return AgentSession.objects.create(
        owner=conversation.owner, conversation=conversation, idempotency_key=f"system:{conversation.id}:"
        f"{conversation.turns.count()}", goal="", locale=conversation.locale, mode="system",
        status="COMPLETED", final_answer=text, cards=json_value(cards or []))


# One price-first greeting; the product no longer asks whether a parent or the student is planning.
GREETING = {
    "zh": "你好！我是 StudyFlow。告诉我想去的学校，我来算学费、住宿和生活费的全程总价，也可以帮你比较几所学校差多少。",
    "en": "Hi! I'm StudyFlow. Tell me the school you have in mind and I'll work out the full-course total for "
          "tuition, housing and living costs, or compare what several schools would cost.",
}


def start(user, locale):
    conversation = AgentConversation.objects.create(owner=user, locale=locale)
    plan = services.plan_for(user)
    cards = []
    if plan is not None:
        cards.append({"type": "plan", "plan": services.plan_record(plan, services.home_currency(user))["plan"]})
    from .guidance import HANDOFFS

    greeting = HANDOFFS[plan.status][locale] if plan and plan.status in HANDOFFS else GREETING[locale]
    _assistant_turn(conversation, greeting, cards)
    open_conversation(conversation)
    return conversation


def open_conversation(conversation):
    """Opening a conversation does not propose a state change."""
    return None


def send(conversation, text, key):
    """Run one user turn. Replays with the same key return the stored turn."""
    existing = AgentSession.objects.filter(owner=conversation.owner, idempotency_key=key).first()
    if existing is not None:
        return existing, False
    turn = AgentSession.objects.create(
        owner=conversation.owner, conversation=conversation, idempotency_key=key, goal=text,
        locale=conversation.locale, mode=settings.STUDYFLOW_AI_MODE)
    agent_runner.run(turn, history=_history_before(conversation, turn), memory=_memory(conversation))
    conversation.save(update_fields=["updated_at"])
    return turn, True


CHOSEN = {
    "zh": ("选这所学校：{name}",
           "已选{name}，按 {years} 年计划，全程约 {total} {currency}。"),
    "en": ("Choose this school: {name}",
           "{name} is in your plan for {years} years, about {total} {currency} in total. "),
}


WITHDRAWN = {
    "zh": "原来按上一所学校申请的模拟贷款已撤回，请在「我的方案」里按新学校重新选择。",
    "en": " The simulated loan applied for the previous school has been withdrawn; choose again for this school in My plan.",
}


def choose(conversation, school_key, years, key):
    """The price card's choose button: save the plan as a turn of its own, without a model call."""
    existing = AgentSession.objects.filter(owner=conversation.owner, idempotency_key=key).first()
    if existing is not None:
        return existing, False
    entry = services.entry_or_404(school_key)
    asked, answer = CHOSEN[conversation.locale]
    name = getattr(entry.school.name, conversation.locale)
    arguments = {"school_key": entry.key, **({"years": years} if years is not None else {})}
    with transaction.atomic():
        turn = AgentSession.objects.create(
            owner=conversation.owner, conversation=conversation, idempotency_key=key,
            goal=asked.format(name=name), locale=conversation.locale, mode="system", status="COMPLETED")
        step = SimpleNamespace(tool="save_plan", rationale="Chosen from a price card", arguments_json="")
        observation = agent_runner._execute(turn, 1, step, {"provider": "system", "purpose": "choose_school"}, arguments)
        # Roll the turn back with the plan: a refused choice (e.g. already enrolled) leaves no trace.
        require(observation.status == "OK", (observation.result or {}).get("error", "PLAN_NOT_SAVED"))
        plan = observation.result["plan"]
        turn.final_answer = answer.format(name=name, years=plan["years"], currency=plan["currency"],
                                          total=f"{float(plan['total']):,.0f}")
        if observation.result.get("withdrawn_application"):
            turn.final_answer += WITHDRAWN[conversation.locale]
        if plan["status"] == "DRAFT":
            from studyflow_ai.agent.loan_rules import advice_reply
            step = SimpleNamespace(tool="simulate_loan", rationale="Recommend after choosing a school", arguments_json="{}")
            advice = agent_runner._execute(turn, 2, step, {"provider": "system", "purpose": "loan_advice"}, {})
            if advice.status == "OK":
                turn.final_answer += advice_reply(advice.result["advice"], conversation.locale)
        turn.save()
    conversation.save(update_fields=["updated_at"])
    return turn, True


def _history_before(conversation, turn):
    rows = []
    for item in conversation.turns.exclude(pk=turn.pk).order_by("created_at"):
        if item.goal:
            rows.append({"role": "user", "text": item.goal[:2000]})
        if item.final_answer:
            rows.append({"role": "assistant", "text": item.final_answer[:2000]})
    return rows[-HISTORY_TURNS:]


def summary(conversation):
    data = record(conversation)
    data["turn_count"] = conversation.turns.count()
    return data
