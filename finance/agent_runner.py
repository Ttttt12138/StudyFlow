"""Agent execution loop: plan one step, execute it, record it (docs/agent.md)."""
import json
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import APIException
from studyflow_ai.agent import AgentContext, AgentPlanner, Observation, ToolSpec
from studyflow_ai.providers.base import ProviderFailure

from . import money
from .agent_models import AgentPendingAction, AgentStep
from .agent_tools import TOOLS, Proposal
from .services import json_value
from .workflow_common import record, require

MAX_STEPS = 10
MAX_WRITES = 4
RESULT_CHARS = 4000
PENDING_SECONDS = 900
FALLBACK = {"zh": "智能助手暂时无法完成这个请求，请稍后再试，或直接使用对应功能。所有资金均为模拟。",
            "en": "The assistant could not complete this request. Try again later or use the features "
                  "directly. All funds are simulated."}


def planner():
    from studyflow_ai.config import Settings

    return AgentPlanner.from_settings(Settings.from_env(settings.STUDYFLOW_AI_MODE))


def _error(exc):
    detail = getattr(exc, "detail", None) or getattr(exc, "messages", None) or str(exc) or type(exc).__name__
    if isinstance(detail, dict) and "detail" in detail:
        detail = detail["detail"]
    return {"error": json_value(detail)}


def _truncate(result):
    """Keep the whole serialized result within RESULT_CHARS (escaping included)."""
    text = json.dumps(result, ensure_ascii=False)
    if len(text) <= RESULT_CHARS:
        return result
    size = RESULT_CHARS
    while True:
        wrapped = {"truncated": True, "preview": text[:size]}
        if len(json.dumps(wrapped, ensure_ascii=False)) <= RESULT_CHARS:
            return wrapped
        size -= 200


def _arguments(step):
    """The planner's arguments if they are a JSON object for a registered tool, else None."""
    if step.tool not in TOOLS:
        return None
    try:
        arguments = json.loads(step.arguments_json)
    except ValueError:
        return None
    return arguments if isinstance(arguments, dict) else None


def _must_stop(observations):
    """Loop-level guards from docs/agent.md, enforced whatever the planner does."""
    last = {}
    for item in observations:
        last[item.tool] = (last.get(item.tool, (False, False))[1], item.status in ("ERROR", "DENIED"))
    if any(all(pair) for pair in last.values()):
        return True
    ranked = [o for o in observations if o.tool == "rank_quotes" and o.status == "OK"]
    return bool(ranked) and ranked[-1].result.get("recommended_quote_id") is None


def _propose(session, number, tool, arguments, step, call, outcome):
    require(not AgentPendingAction.objects.filter(
        owner=session.owner, action=outcome.action, target_id=outcome.target_id, status="PENDING").exists(),
        "ALREADY_PROPOSED")
    pending_id = uuid4()
    expires = timezone.now() + timedelta(seconds=PENDING_SECONDS)
    result = {"pending_action_id": str(pending_id), "action": outcome.action,
              "target_id": str(outcome.target_id), "currency": outcome.currency,
              "amount": money.fmt(outcome.amount, outcome.currency), "expires_at": expires.isoformat(),
              "details": outcome.arguments, "executed": False,
              "requires": ["student_confirmation", "step_up"]}
    saved = AgentStep.objects.create(
        owner=session.owner, session=session, number=number, tool=tool.name, tier=tool.tier,
        arguments=json_value(arguments), rationale=step.rationale, status="PROPOSED", result=result, call=call)
    AgentPendingAction.objects.create(
        id=pending_id, owner=session.owner, session=session, step=saved, action=outcome.action,
        tool=tool.name, arguments=outcome.arguments, target_id=outcome.target_id,
        amount=outcome.amount, currency=outcome.currency, expires_at=expires)
    return result


def _execute(session, number, step, call, arguments):
    user, tool = session.owner, TOOLS[step.tool]
    if tool.tier == "T1" and session.write_count >= MAX_WRITES:
        status, result = "DENIED", {"error": "WRITE_BUDGET_EXHAUSTED"}
    else:
        try:
            with transaction.atomic():
                # Same per-student serialization as CommandView.
                get_user_model().objects.select_for_update().get(pk=user.pk)
                serializer = tool.serializer(data=arguments)
                serializer.is_valid(raise_exception=True)
                outcome = tool.handler(user, serializer.validated_data)
                if isinstance(outcome, Proposal):
                    result = _propose(session, number, tool, arguments, step, call, outcome)
                    return Observation(tool=tool.name, arguments=arguments, status="PROPOSED", result=result)
                status, result = "OK", json_value(outcome)
                if tool.tier == "T1":
                    session.write_count += 1
                    session.save(update_fields=["write_count", "updated_at"])
        except IntegrityError:
            # A concurrent request claimed the same quote or proposal first.
            status, result = "ERROR", {"error": "CONCURRENT_UPDATE"}
        except (APIException, Http404, DjangoValidationError, ValueError) as exc:
            status, result = "ERROR", _error(exc)
    result = _truncate(result)
    AgentStep.objects.create(owner=user, session=session, number=number, tool=tool.name, tier=tool.tier,
                             arguments=json_value(arguments), rationale=step.rationale, status=status,
                             result=result, call=call)
    return Observation(tool=tool.name, arguments=arguments, status=status, result=result)


def run(session):
    brain = planner()
    specs = [ToolSpec(**tool.spec()) for tool in TOOLS.values()]
    observations = []
    try:
        for number in range(1, MAX_STEPS + 2):
            remaining = 0 if _must_stop(observations) else max(MAX_STEPS - number + 1, 0)
            context = AgentContext(goal=session.goal, locale=session.locale, tools=specs,
                                   observations=observations[-12:], steps_remaining=remaining)
            try:
                step, call_record = brain.next_step(context)
            except ProviderFailure as exc:
                AgentStep.objects.create(owner=session.owner, session=session, number=number, status="ERROR",
                                         result={"error": exc.code}, call=exc.record.model_dump(mode="json"))
                session.status, session.error_code = "FAILED", exc.code
                session.final_answer = FALLBACK[session.locale]
                break
            call = call_record.model_dump(mode="json")
            if step.kind == "final":
                AgentStep.objects.create(owner=session.owner, session=session, number=number, status="FINAL",
                                         result={"answer": step.answer}, call=call)
                session.status, session.final_answer = "COMPLETED", step.answer
                break
            arguments = _arguments(step)
            if remaining == 0 or arguments is None:
                # A tool call after the budget is spent, or one the catalog cannot run, ends the session.
                code = "STEP_BUDGET_EXHAUSTED" if remaining == 0 else "INVALID_TOOL_CALL"
                AgentStep.objects.create(owner=session.owner, session=session, number=number, status="ERROR",
                                         result={"error": code, "refused_tool": step.tool[:40]}, call=call)
                session.status, session.error_code = "FAILED", code
                session.final_answer = FALLBACK[session.locale]
                break
            observations.append(_execute(session, number, step, call, arguments))
    finally:
        brain.close()
    session.save()
    return session


def session_record(session):
    data = record(session)
    data.pop("idempotency_key", None)
    data["steps"] = [{k: v for k, v in record(s).items() if k not in {"session", "type"}}
                     for s in session.steps.all()]
    data["pending_actions"] = [record(p) for p in session.pending_actions.all()]
    data["is_simulated"] = True
    return data


def _decide(pending, status, result=None):
    pending.status, pending.decided_at = status, timezone.now()
    pending.result = json_value(result or {})
    pending.version += 1
    pending.save()


def confirm_pending(actor, data, pending):
    """Run a proposed T2 action as the student, through the same services as the API."""
    from . import remittance_orders, wallets
    from .remittance_models import RemittanceOrder
    from .workflow_common import audit, current

    if pending.status == "CONFIRMED":
        return record(pending)
    require(pending.status == "PENDING", "PENDING_ACTION_CLOSED")
    if pending.expires_at <= timezone.now():
        _decide(pending, "EXPIRED")
        return record(pending)
    if pending.action == "remittance.submit":
        order = RemittanceOrder.objects.get(owner=actor, pk=pending.target_id)
        result = remittance_orders.submit(actor, {"expected_version": order.version}, order)
    else:
        result = wallets.convert_balance(actor, {
            "quote_id": pending.target_id, "source_amount": pending.amount,
            "state_version": current(actor).version}, None)
    _decide(pending, "CONFIRMED", result)
    audit(actor, actor, "agent.action_confirmed", pending, {"action": pending.action})
    return record(pending)


def reject_pending(actor, data, pending):
    from .workflow_common import audit

    if pending.status == "REJECTED":
        return record(pending)
    require(pending.status == "PENDING", "PENDING_ACTION_CLOSED")
    _decide(pending, "REJECTED")
    audit(actor, actor, "agent.action_rejected", pending, {"action": pending.action})
    return record(pending)
