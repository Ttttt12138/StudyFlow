from copy import deepcopy
from decimal import Decimal

from django.utils import timezone

from finance.models import FinancialState
from finance.services import VersionConflict, json_value, save_state
from finance.workflow_common import audit, current, owned, record, require
from finance.workflow_models import DemoWallet, FundingSource

from .budget import calculate, forward_snapshot, money
from .models import ReadinessRun, Semester
from .templates import REQUIRED, get_template


def active(owner):
    semester = Semester.objects.filter(owner=owner, enabled=True).first()
    require(semester is not None, "NO_ACTIVE_SEMESTER")
    return semester


def business_date(owner):
    wallet = DemoWallet.objects.filter(owner=owner).first()
    return wallet.clock if wallet else timezone.localdate()


def versions(owner, data):
    semester = owned(Semester, owner, data["semester_id"])
    state = current(owner, data["state_version"])
    if semester.version != data["budget_version"] or not semester.enabled:
        raise VersionConflict()
    if (
        "analysis_version" in data
        and data["analysis_version"] != semester.analysis_version
    ):
        raise VersionConflict()
    return semester, state


def create_semester(owner, data, obj=None):
    require(
        not Semester.objects.filter(owner=owner, enabled=True).exists(),
        "ACTIVE_SEMESTER_EXISTS",
    )
    state = FinancialState.objects.filter(owner=owner).first()
    if state is None:
        require(
            "opening_balance" in data and "as_of" in data,
            "DECLARE_PLANNING_FUNDS_AND_DATE",
        )
        state = save_state(
            owner,
            0,
            {
                "currency": "THB",
                "as_of": data["as_of"],
                "opening_balance": data["opening_balance"],
                "reserve": data["reserve"] or "0.00",
                "events": [],
            },
        )
    template = get_template(
        data["room"], data.get("template_key"), data.get("template_version")
    )
    draft = {
        k: template[k] for k in ("profile", "costs", "reserve", "required_categories")
    }
    draft["reserve"] = str(data["reserve"]) if data["reserve"] is not None else None
    semester = Semester.objects.create(
        owner=owner,
        template_key=template["key"],
        template_version=template["version"],
        draft=draft,
    )
    audit(owner, owner, "readiness.semester_created", semester)
    from .jobs import enqueue_check

    enqueue_check(owner, "semester_created")
    return {**record(semester), "state_version": state.version}


def normalize_draft(owner, draft, previous=None):
    from .contracts import Cost

    result = deepcopy(draft)
    result["required_categories"] = (previous or {}).get(
        "required_categories", result.get("required_categories", REQUIRED)
    )
    previous = {c["cost_id"]: c for c in (previous or {}).get("costs", [])}
    require(
        set(previous).issubset({c["cost_id"] for c in result["costs"]}),
        "KEEP_REQUIRED_COSTS_OR_MARK_NOT_APPLICABLE",
    )
    for cost in result["costs"]:
        old = previous.get(cost["cost_id"], {})
        if cost.get("confidence_type") == "VERIFIED":
            require(
                old.get("confidence_type") == "VERIFIED"
                and cost == Cost.model_validate(old).model_dump(mode="json"),
                "USE_IMPORT_CONFIRMATION_TO_VERIFY",
            )
        else:
            cost["verification_reference"] = None
        if cost.get("beneficiary_id"):
            from finance.workflow_models import Beneficiary

            owned(Beneficiary, owner, cost["beneficiary_id"])
    return result


def converted_draft(owner, draft):
    from finance.budget_services import convert
    from finance.workflow_models import FXQuote

    result = deepcopy(draft)
    for cost in result["costs"]:
        if cost.get("currency") not in {None, "THB"} and cost.get("fx_quote_id"):
            quote = owned(FXQuote, owner, cost["fx_quote_id"])
            if quote.expires_at <= timezone.now():
                cost["fx_issue"] = "FX_EXPIRED"
                continue
            for field in ("amount", "lower", "upper"):
                if cost.get(field) is not None:
                    amount, _, quote = convert(
                        owner,
                        cost[field],
                        cost["currency"],
                        cost["fx_quote_id"],
                        expense=True,
                    )
                    cost[field] = money(amount)
                    cost["fx_snapshot"] = {
                        "id": str(quote.id),
                        "rate": str(quote.rate),
                        "expires_at": quote.expires_at.isoformat(),
                    }
            cost["currency"] = "THB"
    return result


def persist_revision(owner, semester, state, draft):
    snapshot = deepcopy(state.snapshot)
    projected = calculate(converted_draft(owner, draft), snapshot["opening_balance"])
    events = [
        e
        for e in snapshot["events"]
        if not e["id"].startswith("cost:") or "settled_sequence" in e
    ]
    ids = {e["id"] for e in events}
    monthly = {c["cost_id"] for c in draft["costs"] if c.get("period") == "monthly"}
    for event in projected["events"]:
        if event["id"] not in ids:
            if (
                event["id"].split(":")[1] in monthly
                and event["date"] < snapshot["as_of"]
            ):
                continue  # Historical living costs are already outside the opening balance anchor.
            require(
                event["date"] >= snapshot["as_of"],
                "COST_PREDATES_OPENING_CONFIRM_ALREADY_PAID_OR_CHANGE_DATE",
            )
            events.append(event)
    snapshot.update(events=events, reserve=draft.get("reserve") or "0.00")
    require(len(events) <= 1000, "TOO_MANY_SCHEDULED_EVENTS")
    updated = save_state(owner, state.version, snapshot)
    semester.draft, semester.version = json_value(draft), semester.version + 1
    semester.save(update_fields=["draft", "version"])
    audit(
        owner,
        owner,
        "readiness.semester_revised",
        semester,
        {"budget_version": semester.version},
    )
    from .jobs import enqueue_check

    enqueue_check(owner, "budget_changed")
    return {**record(semester), "state_version": updated.version}


def revise_semester(owner, data, obj=None):
    semester, state = versions(owner, data)
    draft = normalize_draft(owner, data["draft"], semester.draft)
    return persist_revision(owner, semester, state, draft)


def budget_result(owner, semester, state, now=None):
    now = now or business_date(owner)
    snapshot = forward_snapshot(state.snapshot, now)
    draft = converted_draft(owner, semester.draft)
    available = settled_balance(snapshot)
    result = calculate(draft, available, now)
    missing_profile = [
        "MISSING_PROFILE:" + field
        for field in ("school", "campus", "country", "program", "student_type")
        if not draft["profile"].get(field)
    ]
    result["issues"].extend(missing_profile)
    result["complete"] = result["complete"] and not missing_profile
    settled = {e["id"]: e for e in state.snapshot["events"] if "settled_sequence" in e}
    paid = sum(
        (Decimal(e["amount"]) for e in result["events"] if e["id"] in settled),
        Decimal(0),
    )
    remaining = max(Decimal(0), Decimal(result["remaining_base"]) - paid)
    result.update(
        remaining_base=money(remaining),
        gap=money(max(Decimal(0), remaining - available)),
    )
    result["sufficient"] = result["complete"] and Decimal(result["gap"]) == 0
    result.update(
        state_version=state.version,
        budget_version=semester.version,
        semester_id=str(semester.id),
        fx_snapshots=[c["fx_snapshot"] for c in draft["costs"] if "fx_snapshot" in c],
    )
    from django.conf import settings

    if settings.STUDYFLOW_CONSUMPTION_ENABLED:
        from finance.consumption.projection import budget_overlay

        result = budget_overlay(owner, state.snapshot, draft, now, result)
    return result


def save_run(owner, semester, state, kind, data, result):
    run = ReadinessRun.objects.create(
        owner=owner,
        semester=semester,
        state_version=state.version,
        budget_version=semester.version,
        analysis_version=semester.analysis_version,
        kind=kind,
        inputs=json_value(data),
        result=json_value(result),
    )
    audit(owner, owner, "readiness." + kind, run)
    return record(run)


def create_budget(owner, data, obj=None):
    semester, state = versions(owner, data)
    return save_run(
        owner, semester, state, "budget", data, budget_result(owner, semester, state)
    )


def create_forecast(owner, data, obj=None):
    from finance.consumption.projection import project_for

    semester, state = versions(owner, data)
    result = project_for(
        owner,
        state.snapshot,
        converted_draft(owner, semester.draft),
        business_date(owner),
        data["horizon"],
        data["conditional"],
    )
    return save_run(owner, semester, state, "forecast", data, result)


def financial_state(owner):
    from django.conf import settings

    from finance.lending_models import LoanAccount

    semester, state = active(owner), current(owner)
    planning = state.snapshot
    if settings.STUDYFLOW_CONSUMPTION_ENABLED:
        from finance.consumption.projection import confirmed_snapshot

        planning = confirmed_snapshot(owner, planning, business_date(owner))
    snapshot = forward_snapshot(planning, business_date(owner))
    wallet = DemoWallet.objects.filter(owner=owner).first()
    return {
        "state_version": state.version,
        "budget_version": semester.version,
        "analysis_version": semester.analysis_version,
        "semester_id": str(semester.id),
        "assets": {
            "planning_balance": money(settled_balance(snapshot)),
            "wallet_balance": money(wallet.balance) if wallet else None,
            "basis": "USER_DECLARED"
            if planning is not state.snapshot
            else "SIMULATED_LEDGER"
            if wallet
            else "USER_DECLARED",
            "balance_as_of": planning["as_of"],
            "currency": "THB",
        },
        "confirmed_obligations": [
            e
            for e in snapshot["events"]
            if e["kind"] == "expense" and e["certainty"] == "confirmed"
        ],
        "estimated_expenses": semester.draft["costs"],
        "cost_provenance": cost_provenance(semester.draft),
        "expected_income": [
            record(s) for s in FundingSource.objects.filter(owner=owner, received=False)
        ],
        "loans": [
            record(account) for account in LoanAccount.objects.filter(owner=owner)
        ],
        "reserve": semester.draft.get("reserve"),
        "budget": budget_result(owner, semester, state),
    }


def cost_provenance(draft):
    from finance.consumption.analysis import provenance

    return {cost["cost_id"]: provenance(cost) for cost in draft["costs"]}


def settled_balance(snapshot):
    balance = Decimal(snapshot["opening_balance"])
    for event in snapshot["events"]:
        if "settled_sequence" in event and event["date"] <= snapshot["as_of"]:
            balance += Decimal(event["amount"]) * (
                1 if event["kind"] == "income" else -1
            )
    return balance
