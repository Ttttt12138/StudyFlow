import hashlib
import json
from copy import deepcopy
from datetime import date
from decimal import Decimal

from django.core import signing
from django.db import transaction

from finance.readiness.models import ImportMaterial, Semester
from finance.readiness.services import business_date, revise_semester, versions
from finance.services import VersionConflict, json_value
from finance.sponsorship import SponsorRequest, create_request, revise_request
from finance.workflow_common import append_state, audit, current, record, require
from finance.workflow_models import Beneficiary, FundingSource, FXQuote, LoanSimulation

from .models import PlanningPreference, WhatIfRun
from .simulation import evaluate, patch_costs


def dependencies(owner, semester):
    state = current(owner)
    payload = {
        "semester_id": str(semester.id),
        "state_version": state.version,
        "budget_version": semester.version,
        "analysis_version": semester.analysis_version,
        "business_date": business_date(owner).isoformat(),
        "draft": semester.draft,
    }
    for model in (FundingSource, LoanSimulation, Beneficiary, FXQuote, SponsorRequest):
        rows = model.objects.filter(owner=owner).order_by("id")
        payload[model.__name__] = [record(row) for row in rows]
    payload["materials"] = list(
        ImportMaterial.objects.filter(owner=owner)
        .order_by("id")
        .values("id", "sha256", "status", "confirmation", "processing")
    )
    digest = hashlib.sha256(
        json.dumps(json_value(payload), sort_keys=True).encode()
    ).hexdigest()
    return {
        k: payload[k]
        for k in (
            "semester_id",
            "state_version",
            "budget_version",
            "analysis_version",
            "business_date",
        )
    } | {"digest": digest}


def fresh(owner, run):
    semester = Semester.objects.get(pk=run.semester_id, owner=owner)
    if not semester.enabled or dependencies(owner, semester) != run.dependencies:
        raise VersionConflict()
    return semester


def create(owner, data, obj=None):
    semester, state = versions(owner, data)
    preference = PlanningPreference.objects.filter(semester=semester).first()
    baseline = evaluate(
        owner,
        semester,
        state,
        {"allow_new_loan": preference.allow_new_loan} if preference else {},
    )
    results = [
        evaluate(owner, semester, state, scenario) for scenario in data["scenarios"]
    ]
    for result in results:
        result["delta"] = {
            k: format(Decimal(result[k]) - Decimal(baseline[k]), ".2f")
            for k in (
                "maximum_reserve_gap",
                "minimum_balance",
                "remaining_expenses",
                "loan_needed",
            )
        }
    run = WhatIfRun.objects.create(
        owner=owner,
        semester=semester,
        dependencies=dependencies(owner, semester),
        inputs=data["scenarios"],
        result={"baseline": baseline, "scenarios": results, "is_simulated": True},
    )
    return view(run)


def view(run):
    semester = Semester.objects.get(pk=run.semester_id)
    return {
        "id": str(run.id),
        **run.result,
        "dependencies": run.dependencies,
        "stale": not semester.enabled
        or dependencies(run.owner, semester) != run.dependencies,
        "applied_index": run.applied_index,
        "application": run.application,
    }


def blockers(semester, scenario):
    costs = {c["cost_id"]: c for c in semester.draft["costs"]}
    return [
        {
            "code": "PROTECTED_COST_REVIEW",
            "cost_id": change["cost_id"],
            "before": costs[change["cost_id"]],
            "proposed": change,
        }
        for change in scenario.get("costs", [])
        if costs[change["cost_id"]].get("locked")
        or costs[change["cost_id"]].get("conflict")
        or costs[change["cost_id"]].get("confidence_type") == "VERIFIED"
    ]


def differences(owner, semester, scenario):
    before = {c["cost_id"]: c for c in semester.draft["costs"]}
    revised = patch_costs(
        deepcopy(semester.draft), scenario.get("costs", []), business_date(owner)
    )
    after = {c["cost_id"]: c for c in revised["costs"]}
    changes = [
        {
            "kind": "cost",
            "id": c["cost_id"],
            "before": before[c["cost_id"]],
            "after": after[c["cost_id"]],
        }
        for c in scenario.get("costs", [])
    ]
    for source in scenario.get("family_support", []):
        previous = FundingSource.objects.filter(
            owner=owner, pk=source.get("source_id")
        ).first()
        changes.append(
            {
                "kind": "family_support",
                "id": source.get("source_id"),
                "before": {
                    k: getattr(previous, k)
                    for k in ("amount", "currency", "available_on", "certainty")
                }
                if previous
                else None,
                "after": {
                    **source,
                    "currency": "THB",
                    "certainty": "estimated",
                    "status": "PENDING",
                },
            }
        )
    if scenario.get("loan"):
        changes.append(
            {"kind": "loan_draft", "before": None, "after": scenario["loan"]}
        )
    preference = PlanningPreference.objects.filter(semester=semester).first()
    prior = preference.allow_new_loan if preference else True
    requested = scenario.get("allow_new_loan", True)
    if prior != requested:
        changes.append({"kind": "allow_new_loan", "before": prior, "after": requested})
    return json_value(changes)


def preview(owner, data, run):
    from .reviews import upsert

    semester = fresh(owner, run)
    index = data["scenario_index"]
    require(index < len(run.inputs), "SCENARIO_NOT_FOUND")
    scenario = run.inputs[index]
    blocked = blockers(semester, scenario)
    if blocked:
        upsert(
            owner,
            "scenario:" + str(run.id) + ":" + str(index),
            "protected_cost",
            run.id,
            {
                "blockers": blocked,
                "scenario_index": index,
                "next_action": "Confirm replacement evidence through the original material workflow, then simulate again.",
            },
        )
    token = (
        None
        if blocked
        else signing.dumps(
            {
                "owner": owner.pk,
                "run": str(run.id),
                "index": index,
                "digest": run.dependencies["digest"],
            },
            salt="copilot-apply-v1",
        )
    )
    return {
        "scenario_index": index,
        "changes": scenario,
        "diff": differences(owner, semester, scenario),
        "blockers": blocked,
        "confirmation": token,
        "expires_in_seconds": 900,
        "is_simulated": True,
    }


def apply_support(owner, changes, run):
    records = []
    for index, change in enumerate(changes):
        data = {
            "amount": Decimal(change["amount"]),
            "currency": "THB",
            "available_on": date.fromisoformat(change["available_on"]),
            "purpose": "Applied what-if support",
        }
        if change.get("source_id"):
            item = SponsorRequest.objects.filter(
                owner=owner, source_id=change["source_id"]
            ).first()
            require(item is not None, "SPONSOR_REQUEST_REQUIRED")
            records.append(
                revise_request(
                    owner,
                    {**data, "action": "revise", "terms_version": item.terms_version},
                    item,
                )
            )
        else:
            records.append(
                create_request(
                    owner, {**data, "economic_key": f"whatif-{run.id}-{index}"}
                )
            )
    return records


def apply_loan(owner, scenario):
    if not scenario.get("loan"):
        return None
    from finance.budget_services import create_loan
    from finance.lending_applications import create_application
    from finance.workflow_serializers import LoanInput

    serializer = LoanInput(data=scenario["loan"])
    serializer.is_valid(raise_exception=True)
    quote = create_loan(owner, serializer.validated_data)
    return {
        "quote": quote,
        "application": create_application(owner, {"quote_id": quote["id"]}),
    }


@transaction.atomic
def apply(owner, data, run):
    try:
        payload = signing.loads(
            data["confirmation"], salt="copilot-apply-v1", max_age=900
        )
    except signing.BadSignature:
        require(False, "CONFIRMATION_INVALID_OR_EXPIRED")
    require(
        payload["owner"] == owner.pk
        and payload["run"] == str(run.id)
        and payload["digest"] == run.dependencies["digest"],
        "CONFIRMATION_MISMATCH",
    )
    if run.applied_index is not None:
        require(run.applied_index == payload["index"], "SCENARIO_ALREADY_APPLIED")
        return run.application
    semester = fresh(owner, run)
    scenario = run.inputs[payload["index"]]
    require(not blockers(semester, scenario), "REVIEW_REQUIRED")
    evaluate(owner, semester, current(owner), scenario)
    before = dependencies(owner, semester)
    diff = differences(owner, semester, scenario)
    if scenario.get("costs"):
        draft = patch_costs(
            deepcopy(semester.draft), scenario["costs"], business_date(owner)
        )
        revise_semester(owner, {**run.dependencies, "draft": draft})
    support = apply_support(owner, scenario.get("family_support", []), run)
    loan = apply_loan(owner, scenario)
    PlanningPreference.objects.update_or_create(
        semester=semester,
        defaults={
            "owner": owner,
            "allow_new_loan": scenario.get("allow_new_loan", True),
            "source_run": run,
        },
    )
    append_state(owner, current(owner).snapshot, owner, "copilot.plan_applied")
    semester.refresh_from_db()
    run.applied_index = payload["index"]
    run.application = json_value(
        {
            "status": "APPLIED",
            "run_id": str(run.id),
            "before": before,
            "after": dependencies(owner, semester),
            "diff": diff,
            "support_requests": support,
            "loan": loan,
            "is_simulated": True,
        }
    )
    run.save(update_fields=["applied_index", "application"])
    audit(
        owner,
        owner,
        "copilot.scenario_applied",
        run,
        {"before": before, "after": run.application["after"], "diff": diff},
    )
    from finance.readiness.jobs import enqueue_check

    transaction.on_commit(lambda: enqueue_check(owner, "scenario_applied"))
    return run.application
