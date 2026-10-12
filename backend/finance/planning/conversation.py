"""Multi-turn planning conversations on top of the single-goal agent loop (finance/agent_runner.py).

Each user message becomes one AgentSession (a turn) linked to the conversation. The planner gets
the earlier turns as history and server facts as memory. Assistant-initiated turns (greeting,
enrollment proposal) have an empty goal and never call a model.
"""

from types import SimpleNamespace

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from finance import agent_runner
from finance.agent_models import AgentPendingAction, AgentSession
from finance.services import json_value
from finance.workflow_common import record

from . import catalog, services
from .models import AgentConversation

HISTORY_TURNS = 12


def _memory(conversation):
    user = conversation.owner
    profile = services.profile(user)
    plan = services.plan_for(user)
    plan_info = None
    if plan is not None:
        full = services.plan_record(plan, services.home_currency(user))["plan"]
        plan_info = {k: full.get(k) for k in ("status", "school_key", "years", "start_date", "total",
                                              "currency", "gap")}
        plan_info["has_loan"] = plan.loan_id is not None
    recent = []
    for turn in conversation.turns.order_by("-created_at")[:6]:
        for step in turn.steps.order_by("-number"):
            for key in [step.arguments.get("school_key"), *(step.arguments.get("school_keys") or [])]:
                if key and key not in recent:
                    recent.append(key)
    return {
        "role": profile.role if profile else None,
        "home_currency": services.home_currency(user),
        "today": services.today_for(user).isoformat(),
        "plan": plan_info,
        "enrollment_due": services.enrollment_due(user, plan),
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


GREETING = {
    None: {"zh": "你好！我是 StudyFlow 留学规划助手。先问一句：你是家长，还是学生本人？",
           "en": "Hi! I'm StudyFlow's study-abroad planner. First: are you a parent, or the student?"},
    "parent": {"zh": "欢迎回来。可以继续问我学费、生活费和全部费用，或者比较几所学校。",
               "en": "Welcome back. Ask about tuition, living costs and the total, or compare schools."},
    "student": {"zh": "欢迎回来。想看看哪所学校的设施、美食和好玩的地方？",
                "en": "Welcome back. Which school's campus, food and things to do shall we look at?"},
}


def start(user, locale):
    conversation = AgentConversation.objects.create(owner=user, locale=locale)
    profile = services.profile(user)
    plan = services.plan_for(user)
    cards = []
    if plan is not None:
        cards.append({"type": "plan", "plan": services.plan_record(plan, services.home_currency(user))["plan"]})
    from .guidance import HANDOFFS

    greeting = HANDOFFS[plan.status][locale] if plan and plan.status in HANDOFFS else GREETING[profile.role if profile else None][locale]
    _assistant_turn(conversation, greeting, cards)
    open_conversation(conversation)
    return conversation


def open_conversation(conversation):
    """Proactive step: from three days before the start date, propose enrollment once."""
    user = conversation.owner
    plan = services.plan_for(user)
    if not services.enrollment_due(user, plan):
        return None
    if AgentPendingAction.objects.filter(owner=user, action="plan.enroll", target_id=plan.id,
                                         status="PENDING").exists():
        return None
    days = services.days_until(plan.start_date, services.today_for(user))
    text = {"zh": (f"距离开学还有 {days} 天。" if days > 0 else "已经到开学日期了。")
            + "学生已经完成报到，还是仍在准备？完成报到后再确认入学，计划中的模拟学费和还款会生成账单。若还在准备或日期有变化，请先告诉我；日期本身不会让计划自动入学。",
            "en": (f"Classes start in {days} day(s). " if days > 0 else "The start date has arrived. ")
            + "Has the student completed registration, or are they still preparing? Confirm enrollment only after registration: planned simulated tuition and repayments become bills. Tell me if you are still preparing or the date has changed. The date alone never enrolls you."}[conversation.locale]
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        turn = _assistant_turn(conversation, text)
        step = SimpleNamespace(tool="confirm_enrollment", rationale="Start date is near", arguments_json="{}")
        agent_runner._execute(turn, 1, step, {"provider": "system", "purpose": "enrollment_due"}, {})
        turn.save()
    return turn


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
