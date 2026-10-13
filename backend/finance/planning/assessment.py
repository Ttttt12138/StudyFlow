"""The planning workspace stores declarations and submits an existing quote once."""
from copy import deepcopy
from datetime import timedelta

from finance import affordability, execution_services, lending_applications
from finance.lending_models import AffordabilityProfile, LoanAccount
from finance.models import FinancialState
from finance.services import VersionConflict, json_value, save_state
from finance.workflow_common import audit, record, require
from finance.workflow_models import DemoWallet, Disbursement, SimulatedApplication

from . import costs, services
from .assessment_loans import create_quotes
from .assessment_projection import projections
from .models import PlanningAssessment


def latest(plan):
    return PlanningAssessment.objects.filter(plan=plan).order_by("-version").first() if plan else None


def defaults(user, plan):
    from finance.lending_core.calculations import month_date
    today = services.today_for(user)
    first_due = max(today, plan.start_date) + timedelta(days=30)
    return {"available_funds": services._s(plan.available_funds) if plan.available_funds is not None else None,
            "funds_currency": plan.funds_currency or services.home_currency(user), "reserve": None,
            "as_of": today.isoformat(), "horizon": 90, "payment_date": None, "supports": [], "costs": [],
            "repayment": {"income": None, "living_expenses": None, "existing_repayments": None,
                          "from_month": first_due.strftime("%Y-%m"),
                          "to_month": month_date(first_due, 47).strftime("%Y-%m"), "changes": []},
            "loan": {"principal": None, "annual_rate": "0.06", "fees": "0.00",
                     "first_due_date": first_due.isoformat(), "periods": [48, 24]}}


def lifecycle(user, plan):
    from finance.lending_ledger import account_record

    ids = {q["id"] for revision in PlanningAssessment.objects.filter(plan=plan)
           for q in revision.result.get("quotes", [])}
    apps = SimulatedApplication.objects.filter(owner=user, loan_id__in=ids).order_by("-created_at")
    accounts = LoanAccount.objects.filter(owner=user, disbursement__application__in=apps)
    return {"applications": [record(a) for a in apps],
            "accounts": [account_record(a) for a in accounts],
            "disbursements": [record(d) for d in Disbursement.objects.filter(owner=user, application__in=apps)]}


def read(user):
    plan = services.plan_for(user)
    if plan is None:
        return {"plan": None, "version": 0, "inputs": None, "quotes": [], "is_simulated": True}
    item = latest(plan)
    stale = bool(item and item.plan_version != plan.version)
    data = deepcopy(item.result) if item else {"quotes": []}
    catalog_version = services.entry_or_404(plan.school_key).version
    stale = stale or ("estimate" in data and data["estimate"].get("catalog_version") != catalog_version)
    progress = lifecycle(user, plan)
    pending_quotes = bool(data.get("quotes")) and not progress["applications"]
    if pending_quotes and "affordability_version" in data:
        stale = stale or data["affordability_version"] != profile_version(user)
    if "estimate" not in data:
        entry = costs.declared_entry(services.entry_or_404(plan.school_key), item.inputs if item else {})
        data["estimate"] = services.estimate(entry, plan.years, services.home_currency(user))
    return {**data, "plan": services.plan_record(plan, services.home_currency(user))["plan"],
            "inputs": item.inputs if item else defaults(user, plan),
            "version": item.version if item else 0, "plan_version": plan.version,
            "stale": stale, "lifecycle": progress, "is_simulated": True}


def profile_version(user):
    return AffordabilityProfile.objects.filter(owner=user).values_list("version", flat=True).first() or 0


def ensure_current_quote(user, quote_id):
    """Legacy application routes must not bypass revision checks on planning quotes."""
    revision = PlanningAssessment.objects.filter(owner=user,
        result__quotes__contains=[{"id": str(quote_id)}]).order_by("-version").first()
    if revision is None:
        return
    current = latest(revision.plan)
    require(current.pk == revision.pk and current.plan_version == revision.plan.version,
            "PLANNING_ASSESSMENT_STALE")
    require(revision.result.get("estimate", {}).get("catalog_version") == services.entry_or_404(revision.plan.school_key).version,
            "PLANNING_ASSESSMENT_STALE")
    active = [a for a in lifecycle(user, revision.plan)["applications"]
              if a["status"] in ("UNDER_REVIEW", "APPROVED", "DISBURSED")]
    require(not active, "PLANNING_ACTIVE_APPLICATION")


def check_versions(plan, item, data):
    if plan.version != data["plan_version"] or (item.version if item else 0) != data["expected_version"]:
        raise VersionConflict()


def remember_facts(user, plan, facts):
    previous = latest(plan)
    if previous is None and not set(facts) & {"available_funds", "monthly_income", "monthly_expenses", "existing_repayments", "support_amount", "principal"}:
        return
    inputs = deepcopy(previous.inputs) if previous else defaults(user, plan)
    if previous and previous.result.get("estimate", {}).get("school_key") not in (None, plan.school_key):
        fresh = defaults(user, plan)
        inputs.update(costs=[], payment_date=None, loan=fresh["loan"])
    for key in ("available_funds", "funds_currency"):
        if key in facts:
            inputs[key] = json_value(facts[key])
    currency = facts.get("funds_currency") or inputs["funds_currency"]
    for source, target in (("monthly_income", "income"), ("monthly_expenses", "living_expenses"),
                           ("existing_repayments", "existing_repayments")):
        if source in facts:
            value = services.convert(facts[source], facts.get(source + "_currency", currency), "THB")
            inputs["repayment"][target] = value["amount"] if value else None
    if "principal" in facts:
        value = services.convert(facts["principal"], facts.get("principal_currency", currency), "THB")
        inputs["loan"]["principal"] = value["amount"] if value else None
    if "support_amount" in facts:
        inputs["supports"] = [r for r in inputs["supports"] if r["id"] != "family-chat"] + [{
            "id": "family-chat", "amount": json_value(facts["support_amount"]), "currency": facts.get("support_currency", currency),
            "available_on": json_value(facts.get("support_date")), "confirmed": False}]
    PlanningAssessment.objects.create(owner=user, plan=plan, version=(previous.version if previous else 0) + 1,
        plan_version=plan.version, inputs=inputs, result={"quotes": [], "draft": True,
            "estimate": services.estimate(services.entry_or_404(plan.school_key), plan.years)})


def save(user, data, obj=None):
    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    check_versions(plan, latest(plan), data)
    inputs = json_value(data["inputs"])
    entry = costs.declared_entry(services.entry_or_404(plan.school_key), inputs)
    result = {"quotes": [], "draft": data.get("draft", False), "affordability_version": profile_version(user)}
    if not data.get("draft"):
        projection = projections(entry, inputs, plan.years, plan.start_date)
        result.update(**projection, quotes=create_quotes(user, inputs, projection),
                      estimate=services.estimate(entry, plan.years, services.home_currency(user)))
    item = PlanningAssessment.objects.create(owner=user, plan=plan, version=data["expected_version"] + 1,
             plan_version=plan.version, inputs=inputs, result=json_value(result))
    audit(user, user, "planning.assessment_saved", item, {"version": item.version})
    return read(user)


def ensure_demo_state(user):
    state = FinancialState.objects.filter(owner=user).first()
    if state is None:
        state = save_state(user, 0, {"currency": "THB", "as_of": services.today_for(user).isoformat(),
            "opening_balance": "0.00", "reserve": "0.00", "events": []})
    if not DemoWallet.objects.filter(owner=user).exists():
        execution_services.initialize(user, {"state_version": state.version})


def submit(user, data, obj=None):
    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    item = latest(plan)
    check_versions(plan, item, data)
    require(item is not None and item.plan_version == plan.version, "PLANNING_ASSESSMENT_STALE")
    require(not item.result.get("draft"), "PLANNING_ASSESSMENT_STALE")
    quote = next((q for q in item.result["quotes"] if q["id"] == str(data["quote_id"])), None)
    require(quote is not None, "QUOTE_NOT_IN_CURRENT_ASSESSMENT")
    existing = SimulatedApplication.objects.filter(owner=user, loan_id=data["quote_id"]).first()
    if existing and existing.status != "DRAFT":
        return {"application": record(existing), "assessment_version": item.version}
    require(item.result.get("affordability_version", 0) == profile_version(user), "PLANNING_ASSESSMENT_STALE")
    active = [a for a in lifecycle(user, plan)["applications"] if a["status"] in ("UNDER_REVIEW", "APPROVED", "DISBURSED")]
    require(not active, "PLANNING_ACTIVE_APPLICATION")
    ensure_demo_state(user)
    profile = AffordabilityProfile.objects.filter(owner=user).first()
    rows = {r["month"]: r for r in profile.months} if profile else {}
    rows.update({r["month"]: r for r in quote["repayment_months"]})
    affordability.save_profile(user, {"expected_version": profile.version if profile else 0,
                                      "months": sorted(rows.values(), key=lambda r: r["month"])})
    if existing is None:
        created = lending_applications.create_application(user, {"quote_id": data["quote_id"]})
        existing = SimulatedApplication.objects.get(owner=user, pk=created["id"])
    result = lending_applications.application_action(user, {"expected_version": existing.version, "action": "submit"}, existing)
    return {"application": result, "assessment_version": item.version, "is_simulated": True}
