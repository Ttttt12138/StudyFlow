"""Sidebar history: the schools a student chose (at most three drafts) and their price lookups across conversations.

Choosing a school saves it as a draft, one per school, newest first; a fourth school drops the oldest. Opening a
draft makes it the current plan again, with the funds and loan picked for it, as long as the current plan is still a
draft (a confirmed or signed plan is not replaced from the sidebar).
"""
from copy import deepcopy
from datetime import date, timedelta

from finance.workflow_common import audit, require

from . import catalog, services
from .models import PlanDraft

LIMIT = 3
PRICES = 20


def remember(user, plan):
    """Saves the plan as the draft for its school and keeps only the newest three."""
    from .assessment import latest

    item = latest(plan)
    PlanDraft.objects.update_or_create(owner=user, school_key=plan.school_key, defaults={
        "years": plan.years, "available_funds": plan.available_funds, "funds_currency": plan.funds_currency or "",
        "inputs": deepcopy(item.inputs) if item else {}})
    for old in PlanDraft.objects.filter(owner=user).order_by("-updated_at")[LIMIT:]:
        old.delete()


def record(draft, plan, home):
    entry = catalog.school(draft.school_key)
    loan = (draft.inputs or {}).get("loan") or {}
    total = services.estimate(entry, draft.years, home) if entry else None
    return {"id": str(draft.id), "school_key": draft.school_key, "name": entry.school.name.model_dump() if entry else None,
            "years": int(draft.years) if draft.years == int(draft.years) else draft.years,
            "total": total["total"] if total else None, "currency": total["currency"] if total else None,
            "available_funds": f"{draft.available_funds:.2f}" if draft.available_funds is not None else None,
            "funds_currency": draft.funds_currency or None,
            "loan": {"principal": loan.get("principal"), "months": loan.get("months"), "product": loan.get("product")} if loan else None,
            "current": plan is not None and plan.school_key == draft.school_key,
            "updated_at": draft.updated_at.isoformat()}


def price_rows(user):
    """The latest price lookups and comparisons from every conversation of this account, newest first."""
    from finance.agent_models import AgentSession

    rows = []
    turns = AgentSession.objects.filter(owner=user, conversation__isnull=False).exclude(cards=[]).order_by("-created_at")
    for turn in turns.only("id", "conversation_id", "created_at", "cards")[:200]:
        for index in reversed(range(len(turn.cards))):
            card = turn.cards[index]
            if card.get("type") in ("cost", "comparison"):
                rows.append({"id": f"{turn.id}:{index}", "conversation_id": str(turn.conversation_id),
                             "created_at": turn.created_at.isoformat(), "card": card})
        if len(rows) >= PRICES:
            break
    return rows[:PRICES]


def history(user):
    plan = services.plan_for(user)
    home = services.home_currency(user)
    return {"prices": price_rows(user),
            "drafts": [record(d, plan, home) for d in PlanDraft.objects.filter(owner=user).order_by("-updated_at")[:LIMIT]],
            "draft_limit": LIMIT, "is_simulated": True}


def open_draft(user, data, draft):
    """Makes a saved draft the current plan again, restoring the funds and loan picked for that school."""
    from .assessment import defaults, latest
    from .models import PlanningAssessment

    plan = services.plan_for(user)
    require(plan is None or plan.status == "DRAFT", "PLAN_NOT_DRAFT_FOR_SWITCH")
    facts = {"school_key": draft.school_key, "years": draft.years}
    if draft.available_funds is not None:
        facts.update(available_funds=draft.available_funds, funds_currency=draft.funds_currency or None)
    services.save_plan(user, facts)
    plan = services.plan_for(user)
    if draft.inputs:
        inputs, fresh = deepcopy(draft.inputs), defaults(user, plan)
        # Dates move on while a draft waits: start from today and keep the first repayment in the future.
        inputs["as_of"] = fresh["as_of"]
        if date.fromisoformat(inputs["loan"]["first_due_date"]) <= services.today_for(user) + timedelta(days=1):
            inputs["loan"]["first_due_date"] = fresh["loan"]["first_due_date"]
        previous = latest(plan)
        PlanningAssessment.objects.create(owner=user, plan=plan, version=(previous.version if previous else 0) + 1,
                                          plan_version=plan.version, inputs=inputs, result={"quotes": [], "draft": True})
        remember(user, plan)
    audit(user, user, "planning.draft_opened", draft, {"school_key": draft.school_key})
    return {**history(user), "plan": services.plan_record(plan, services.home_currency(user))["plan"]}
