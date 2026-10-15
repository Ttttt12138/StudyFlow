"""The planning workspace stores the loan the family typed and submits its quote once."""
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal

from finance import execution_services, lending_applications
from finance.lending_models import LoanAccount
from finance.models import FinancialState
from finance.services import VersionConflict, json_value, save_state
from finance.workflow_common import audit, record, require
from finance.workflow_models import DemoWallet, Disbursement, SimulatedApplication

from . import services
from .assessment_loans import create_quotes, limit
from .models import PlanningAssessment, StudyTask

DEFAULT_BORROWER = "student_with_parent"
# Stored by assessments saved before the user typed the loan amount; no longer shown.
RETIRED = ("forecast", "conditional_forecast", "suggested_principal", "prequal")


def latest(plan):
    return PlanningAssessment.objects.filter(plan=plan).order_by("-version").first() if plan else None


def defaults(user, plan):
    first_due = max(services.today_for(user), plan.start_date) + timedelta(days=30)
    return {"borrower": DEFAULT_BORROWER,
            "loan": {"product": "custom", "principal": None, "annual_rate": "0.06", "fees": "0.00",
                     "first_due_date": first_due.isoformat(), "months": 48, "method": "amortized"}}


def current_inputs(stored, user, plan):
    """Inputs as the panel edits them: the borrower and the loan. Keys of older revisions (funds, supports, costs,
    budget, term lists) are dropped."""
    fresh = defaults(user, plan)
    loan = dict(stored.get("loan") or {})
    if "months" not in loan and loan.get("periods"):
        loan["months"] = loan["periods"][0]
    return {"borrower": stored.get("borrower") or DEFAULT_BORROWER,
            "loan": {key: loan.get(key, value) for key, value in fresh["loan"].items()}}


def planning_loan(loan_id):
    """Whether a simulated loan was quoted in a study plan (its payout follows signing, not an operator)."""
    return PlanningAssessment.objects.filter(result__quotes__contains=[{"id": str(loan_id)}]).exists()


def plan_loans(plan):
    """Every simulated loan quoted for this plan, across assessment revisions."""
    return {q["id"] for revision in PlanningAssessment.objects.filter(plan=plan) for q in revision.result.get("quotes", [])}


def lifecycle(user, plan):
    from finance.lending_ledger import account_record

    apps = SimulatedApplication.objects.filter(owner=user, loan_id__in=plan_loans(plan)).order_by("-created_at")
    accounts = LoanAccount.objects.filter(owner=user, disbursement__application__in=apps)
    return {"applications": [record(a) for a in apps],
            "accounts": [account_record(a) for a in accounts],
            "disbursements": [record(d) for d in Disbursement.objects.filter(owner=user, application__in=apps)]}


def read(user):
    from . import loan_stage, products
    from .payees import payee_record

    plan = services.plan_for(user)
    if plan is None:
        return {"plan": None, "version": 0, "inputs": None, "quotes": [], "is_simulated": True}
    item = latest(plan)
    stale = bool(item and item.plan_version != plan.version)
    data = {k: v for k, v in deepcopy(item.result).items() if k not in RETIRED} if item else {"quotes": []}
    catalog_version = services.entry_or_404(plan.school_key).version
    stale = stale or ("estimate" in data and data["estimate"].get("catalog_version") != catalog_version)
    if "estimate" not in data:
        data["estimate"] = services.estimate(services.entry_or_404(plan.school_key), plan.years, services.home_currency(user))
    inputs = current_inputs(item.inputs, user, plan) if item else defaults(user, plan)
    documents = [{"id": str(t.id), "key": t.template_key, "title": loan_stage.document_title(t.template_key),
                  "done": t.done, "auto": t.template_key == loan_stage.ADMISSION,
                  "due_date": t.due_date.isoformat() if t.due_date else None, "version": t.version}
                 for t in StudyTask.objects.filter(plan=plan, template_key__startswith=loan_stage.PREFIX).order_by("created_at")]
    data["loan_stage"] = {"documents": documents, "payouts": loan_stage.payout_records(plan),
                          "signed": loan_stage.signed(plan), "school_payee": payee_record(plan)}
    return {**data, "plan": services.plan_record(plan, services.home_currency(user))["plan"],
            "inputs": inputs, "products": products.offers(inputs["loan"]["annual_rate"]),
            "limit": limit(plan, inputs["loan"]["fees"]),
            "version": item.version if item else 0, "plan_version": plan.version,
            "stale": stale, "lifecycle": lifecycle(user, plan), "is_simulated": True}


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
    """Keeps the assessment in step with a re-saved plan; a loan amount said in the chat becomes the typed principal.

    Returns that principal in THB, or None when none was said (or it could not be converted)."""
    previous = latest(plan)
    if previous is None and facts.get("principal") is None:
        return None
    inputs = current_inputs(previous.inputs, user, plan) if previous else defaults(user, plan)
    if previous and previous.result.get("estimate", {}).get("school_key") not in (None, plan.school_key):
        inputs["loan"] = defaults(user, plan)["loan"]  # a loan worked out for another school does not carry over
    if facts.get("principal") is not None:
        currency = (facts.get("principal_currency") or services.home_currency(user)).upper()
        value = services.convert(facts["principal"], currency, "THB")
        inputs["loan"]["principal"] = value["amount"] if value else None
    PlanningAssessment.objects.create(owner=user, plan=plan, version=(previous.version if previous else 0) + 1,
        plan_version=plan.version, inputs=inputs, result={"quotes": [], "draft": True,
            "estimate": services.estimate(services.entry_or_404(plan.school_key), plan.years)})
    return inputs["loan"]["principal"] if facts.get("principal") is not None else None


def save(user, data, obj=None):
    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    check_versions(plan, latest(plan), data)
    inputs = current_inputs(json_value(data["inputs"]), user, plan)
    result = {"quotes": [], "draft": data.get("draft", False)}
    if not data.get("draft"):
        cap = limit(plan, inputs["loan"]["fees"])["max_principal"]
        result.update(quotes=create_quotes(user, inputs, cap, plan),
                      estimate=services.estimate(services.entry_or_404(plan.school_key), plan.years,
                                                 services.home_currency(user)))
    item = PlanningAssessment.objects.create(owner=user, plan=plan, version=data["expected_version"] + 1,
             plan_version=plan.version, inputs=inputs, result=json_value(result))
    audit(user, user, "planning.assessment_saved", item, {"version": item.version})
    if not data.get("draft"):
        from .drafts import remember
        remember(user, plan)  # the school's draft keeps the loan last worked out
    return read(user)


def _withdraw_others(user, plan, keep):
    """Re-confirming with another loan withdraws the plan's earlier unsigned application."""
    apps = SimulatedApplication.objects.filter(owner=user, loan_id__in=plan_loans(plan),
                                               status__in=["DRAFT", "UNDER_REVIEW", "APPROVED"])
    for app in apps.exclude(loan_id=keep):
        lending_applications.application_action(user, {"expected_version": app.version, "action": "cancel"}, app)


def confirm(user, data, obj=None):
    """The panel's one confirmation: the chosen simulated loan is submitted and the plan is confirmed together."""
    from . import guidance

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    require(plan.status == "DRAFT", "PLAN_NOT_DRAFT")
    item = latest(plan)
    check_versions(plan, item, data)
    _withdraw_others(user, plan, data["quote_id"])
    application = submit(user, data)["application"]
    services.confirm_plan(user, plan)
    # The figures were just confirmed as they are, so the assessment stays current for the confirmed plan.
    PlanningAssessment.objects.filter(pk=item.pk).update(plan_version=plan.version)
    guidance.append_confirmed(user, plan)
    return {**read(user), "application": application}


def ensure_demo_state(user):
    state = FinancialState.objects.filter(owner=user).first()
    if state is None:
        state = save_state(user, 0, {"currency": "THB", "as_of": services.today_for(user).isoformat(),
            "opening_balance": "0.00", "reserve": "0.00", "events": []})
    if not DemoWallet.objects.filter(owner=user).exists():
        execution_services.initialize(user, {"state_version": state.version})


def _attach_documents(user, plan, item, application):
    """An application under way gets the simulated admission notice and the documents the family confirms."""
    from . import loan_stage

    if application["status"] in ("APPROVED", "UNDER_REVIEW"):
        loan_stage.seed_documents(user, plan, item.inputs.get("borrower") or DEFAULT_BORROWER)


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
        result = record(existing)
        _attach_documents(user, plan, item, result)
        return {"application": result, "assessment_version": item.version}
    active = [a for a in lifecycle(user, plan)["applications"] if a["status"] in ("UNDER_REVIEW", "APPROVED", "DISBURSED")]
    require(not active, "PLANNING_ACTIVE_APPLICATION")
    ensure_demo_state(user)
    if existing is None:
        created = lending_applications.create_application(user, {"quote_id": data["quote_id"]})
        existing = SimulatedApplication.objects.get(owner=user, pk=created["id"])
    cap = limit(plan, current_inputs(item.inputs, user, plan)["loan"]["fees"])["max_principal"]
    result = planning_decision(user, existing, cap)
    _attach_documents(user, plan, item, result)
    return {"application": result, "assessment_version": item.version, "is_simulated": True}


def planning_decision(user, application, cap):
    """A planning loan is approved (simulated) when it stays within the limit (the full-course total in THB) and its first repayment is still ahead. Monthly income is not part of the decision."""
    require(application.status == "DRAFT", "INVALID_STATE")
    lending_applications.ensure_future(application.loan)
    within = cap is not None and Decimal(application.loan.result["principal"]) <= Decimal(cap)
    application.assessment = {"status": "WITHIN_LIMIT" if within else "ABOVE_LIMIT", "max_principal": cap}
    application.status = "APPROVED" if within else "REJECTED"
    audit(user, user, "application.SUBMITTED", application)
    return lending_applications.changed(application, user, "application." + application.status)
