"""Persist only observed outcomes and short provider rationales, never invented reasoning."""

from finance.services import json_value

from .models import ExplanationTrace


def calls_in(value):
    if not isinstance(value, dict):
        return []
    calls = list(value.get("calls", []))
    for key, nested in value.items():
        if key != "calls" and isinstance(nested, dict):
            calls.extend(calls_in(nested))
    return calls


def layer(calls, outcome):
    return {
        "status": "FAILED"
        if any(c.get("error_code") for c in calls)
        else "MOCK"
        if calls
        and all(c.get("mode") == "mock" or c.get("provider") == "rules" for c in calls)
        else "EXECUTED"
        if calls
        else "NOT_CALLED",
        "calls": calls,
        "outcome": outcome,
    }


def capture(instance):
    result = getattr(instance, "result", {}) or {}
    calls = calls_in(result)
    jev = [
        c
        for c in calls
        if c.get("provider") in {"typesafe", "jev"}
        or c.get("provider") == "rules"
        and c.get("purpose") == "classify"
    ]
    llm = [c for c in calls if c not in jev]
    trace_id = result.get("trace_id") or str(instance.id)
    routing = result.get("routing") or {}
    previous = ExplanationTrace.objects.filter(
        owner=instance.owner, trace_id=trace_id
    ).first()
    inputs = getattr(instance, "inputs", {}) or (
        previous.layers.get("deterministic", {}).get("inputs", {}) if previous else {}
    )
    layers = {
        "jev": layer(jev, routing),
        "llm": layer(
            llm, {k: result[k] for k in ("draft", "funding", "issues") if k in result}
        ),
        "deterministic": {
            "status": "EXECUTED"
            if (
                type(instance).__name__ == "WhatIfRun"
                or type(instance).__name__ in {"ReadinessRun", "ReadinessJob"}
                and instance.kind
                in {"budget", "forecast", "funding", "recommendation", "check"}
            )
            and result
            and not result.get("superseded")
            else "NOT_CALLED",
            "engine_version": "cashflow-thb-v1",
            "inputs": inputs,
            "formulas": {
                "budget_gap": "max(0, remaining_base_including_reserve - settled_planning_funds)",
                "reserve_gap": "max(0, reserve - minimum_intraday_balance)",
                "loan_net_proceeds": "principal - fees",
            },
            "outcome": {
                k: v
                for k, v in result.items()
                if k not in {"calls", "routing", "funding", "draft"}
            },
        },
        "policy": {
            "status": "OBSERVED",
            "decision": result.get("validation")
            or result.get("status")
            or getattr(instance, "status", None),
            "rules": result.get("issues", []),
            "next_action": "Inspect linked business status; model output does not authorize execution",
        },
    }
    if result.get("reused"):
        layers["llm"]["status"] = "CACHED"
        layers["llm"]["calls_are_original"] = True
    if getattr(instance, "error_code", ""):
        layers["policy"].update(decision="RETRY", error_code=instance.error_code)
    ExplanationTrace.objects.update_or_create(
        owner=instance.owner,
        trace_id=trace_id,
        defaults={"entity_id": instance.id, "layers": json_value(layers)},
    )


def audit_decision(action):
    if action in {"application.UNDER_REVIEW", "payment.invoice_mismatch"}:
        return "REVIEW_REQUIRED"
    if action in {"application.REJECTED", "payment.authorization_revoked"}:
        return "BLOCKED"
    if action in {
        "application.APPROVED",
        "payment.authorized",
        "payment.mock_submitted",
        "payment.reconciled",
    }:
        return "ALLOWED"
    return None


def capture_audit(instance):
    if not instance.action.startswith(("payment.", "application.", "beneficiary.")):
        return
    trace_id = str(instance.entity_id)
    existing = ExplanationTrace.objects.filter(
        owner=instance.owner, trace_id=trace_id
    ).first()
    layers = (
        existing.layers
        if existing
        else {k: {"status": "NOT_CALLED"} for k in ("jev", "llm", "deterministic")}
    )
    events = layers.get("policy", {}).get("events", [])
    events.append(
        {
            "action": instance.action,
            "timestamp": instance.created_at.isoformat(),
            "details": instance.details,
            "decision": audit_decision(instance.action),
        }
    )
    layers["policy"] = {
        "status": "EXECUTED",
        "decision": audit_decision(instance.action),
        "decision_scope": instance.action,
        "events": events,
        "next_action": "Follow the linked business workflow; this event only authorizes its recorded transition",
    }
    ExplanationTrace.objects.update_or_create(
        owner=instance.owner,
        trace_id=trace_id,
        defaults={"entity_id": instance.entity_id, "layers": layers},
    )


def capture_denial(actor, path, response):
    from uuid import uuid4

    trace = uuid4()
    layers = {k: {"status": "NOT_CALLED"} for k in ("jev", "llm", "deterministic")}
    layers["policy"] = {
        "status": "EXECUTED",
        "decision": "BLOCKED",
        "route": path,
        "http_status": response.status_code,
        "rules": json_value(response.data),
        "next_action": "Correct the rejected request or supply the required evidence; refresh on 409",
    }
    ExplanationTrace.objects.create(
        owner=actor, trace_id=str(trace), entity_id=trace, layers=layers
    )
    response["X-StudyFlow-Trace-ID"] = str(trace)
