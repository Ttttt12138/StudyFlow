"""Prepare one recommended loan quote; application, signature and payments remain explicit."""
from copy import deepcopy

from finance.services import json_value
from finance.workflow_common import audit, require

from . import assessment, services
from . import loan_recommendations as recommendations
from .assessment_loans import calculate_preview
from .models import PlanningAssessment


def _remember(user, plan, state, advice):
    item = assessment.latest(plan)
    result = deepcopy(item.result) if item else {"quotes": [], "draft": True}
    version = (item.version if item else 0) + 1
    advice = {**advice, "assessment_version": version, "plan_version": plan.version}
    result["loan_advice"] = advice
    revision = PlanningAssessment.objects.create(owner=user, plan=plan, version=version,
        plan_version=item.plan_version if item else plan.version, inputs=state["inputs"], result=json_value(result))
    audit(user, user, "planning.loan_advice", revision, {"status": advice["status"]})
    return advice


def _response(plan, advice):
    # Keep observations below the agent result budget; full schedules live in the assessment.
    return {"plan_id": str(plan.id), "advice": advice, "is_simulated": True}


def _amount(user, terms, request):
    if request.get("principal") is None:
        return terms
    currency = (request.get("principal_currency") or services.home_currency(user)).upper()
    converted = services.convert(request["principal"], currency, "THB")
    require(converted is not None, "FX_RATE_UNAVAILABLE")
    return {**terms, "principal": converted["amount"]}


def _previous(state):
    if not state["quotes"]:
        return None
    result = state["quotes"][0]["result"]
    return {**{k: result[k] for k in ("principal", "total_interest", "total_repayment")},
            "monthly_payment": result["maximum_installment"]}


def _preferences(request, previous):
    constraints = dict(previous.get("constraints") or {})
    if request.get("intent") in ("lower_monthly", "lower_interest"):
        constraints.pop("months", None)
    constraints.update({key: request[key] for key in ("product", "months", "method") if key in request})
    intent = request.get("intent") or (previous.get("intent") if request.get("principal") else None) or "recommend"
    return {**constraints, **request, "intent": intent}, constraints


def _store_quote(user, plan, state, selected):
    inputs = deepcopy(state["inputs"])
    inputs["loan"].update({k: selected[k] for k in ("principal", "product", "months", "method")})
    return assessment.save(user, {"expected_version": state["version"], "plan_version": plan.version,
                                  "inputs": inputs, "draft": False})


def _ready(user, plan, state):
    quote = state["quotes"][0]
    previous = state.get("loan_advice") or {}
    selected = recommendations.compact(calculate_preview(plan, state["inputs"]["loan"], state["inputs"]["loan"]))
    advice = {**previous, "status": "recommended", "selected": selected, "quote_id": quote["id"],
              "ready_to_apply": True, "assessment_version": state["version"], "plan_version": plan.version}
    return _response(plan, advice)


def advise(user, request):
    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    state = assessment.read(user)
    if plan.status != "DRAFT" or any(a["status"] in ("UNDER_REVIEW", "APPROVED", "DISBURSED")
                                    for a in state["lifecycle"]["applications"]):
        return _response(plan, {"status": "submitted"})
    intent = request.get("intent", "recommend")
    prior = state.get("loan_advice") or {}
    if intent == "pause" or prior.get("status") == "paused" and intent == "recommend" and not request.get("principal"):
        advice = _remember(user, plan, state, {"status": "paused", "ready_to_apply": False})
        return _response(plan, advice)
    if intent == "apply" and state["quotes"] and not state.get("draft") and not state.get("stale"):
        return _ready(user, plan, state)
    request, constraints = _preferences(request, prior)
    intent = request["intent"]
    terms = _amount(user, state["inputs"]["loan"], request)
    if not terms.get("principal") or intent == "reduce_amount" and request.get("principal") is None:
        advice = {"status": "needs_amount", "intent": intent, "ready_to_apply": False,
                  "product": recommendations.recommended_product(terms, request), "constraints": constraints}
        return _response(plan, _remember(user, plan, state, advice))
    return _recommend(user, plan, (state, terms, request, constraints))


def _recommend(user, plan, context):
    state, terms, request, constraints = context
    intent = request.get("intent", "recommend")
    rows = recommendations.rank(recommendations.candidates(plan, terms, request), request, terms)
    selected = rows[0]
    previous = _previous(state)
    saved = _store_quote(user, plan, state, selected)
    alternatives = [row for row in rows[1:] if row["months"] == selected["months"]][:1]
    advice = {"status": "recommended", "intent": intent, "selected": selected, "alternatives": alternatives,
              "constraints": constraints,
              "change": recommendations.changes(previous, selected), "quote_id": saved["quotes"][0]["id"],
              "ready_to_apply": intent == "apply", "assessment_version": saved["version"], "plan_version": plan.version}
    # Attach guidance to the revision just created, so its quote and version stay the same.
    item = assessment.latest(plan)
    item.result["loan_advice"] = advice
    item.save(update_fields=["result"])
    return _response(plan, advice)
