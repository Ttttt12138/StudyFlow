"""The planning workspace stores declarations and submits an existing quote once."""
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal

from finance import execution_services, lending_applications
from finance.lending_models import LoanAccount
from finance.models import FinancialState
from finance.services import VersionConflict, json_value, save_state
from finance.workflow_common import audit, record, require
from finance.workflow_models import DemoWallet, Disbursement, SimulatedApplication

from . import costs, prequal, services
from .assessment_loans import create_quotes
from .assessment_projection import projections
from .models import PlanningAssessment, StudyTask


def latest(plan):
    return PlanningAssessment.objects.filter(plan=plan).order_by("-version").first() if plan else None


def necessary_expenses(plan):
    """Monthly necessary expenses in THB, estimated from the school's first-year living costs
    (housing, food, transport, communications); None when the catalog or FX rate cannot supply it."""
    rows = [r for r in costs.estimate(services.entry_or_404(plan.school_key), plan.years)["lines"]
            if r["group"] == "living" and r["per_year"] is not None]
    if not rows:
        return None
    monthly = sum((Decimal(r["per_year"]) for r in rows), Decimal(0)) / 12
    value = services.convert(monthly, services.entry_or_404(plan.school_key).school.currency, "THB")
    return value["amount"] if value else None


def with_necessary_expenses(inputs, plan):
    """Necessary expenses are identified by the system unless the student declared their own."""
    if inputs["repayment"].get("living_expenses") in (None, ""):
        inputs["repayment"]["living_expenses"] = necessary_expenses(plan)
    return inputs


def defaults(user, plan):
    today = services.today_for(user)
    first_due = max(today, plan.start_date) + timedelta(days=30)
    return {"available_funds": services._s(plan.available_funds) if plan.available_funds is not None else None,
            "funds_currency": plan.funds_currency or services.home_currency(user), "reserve": None,
            "as_of": today.isoformat(), "horizon": 90, "payment_date": None, "supports": [], "costs": [],
            # No budget window: the monthly budget covers each loan's own repayment months.
            "repayment": {"income": None, "living_expenses": necessary_expenses(plan), "existing_repayments": None,
                          "from_month": "", "to_month": "", "changes": []},
            "loan": {"principal": None, "annual_rate": "0.06", "fees": "0.00",
                     "first_due_date": first_due.isoformat(), "periods": [48, 24]}}


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
    if "estimate" not in data:
        entry = costs.declared_entry(services.entry_or_404(plan.school_key), item.inputs if item else {})
        data["estimate"] = services.estimate(entry, plan.years, services.home_currency(user))
    from . import loan_stage, products
    from .payees import payee_record

    stored = (data.get("prequal") or {}).get("products") if isinstance(data.get("prequal"), dict) else None
    if isinstance(data.get("prequal"), dict) and item and (stored is None or any("methods" not in o for o in stored)):
        # Assessments saved before the product catalog (or its repayment methods) still show every product's offer.
        data["prequal"]["products"] = products.offers(item.inputs["loan"]["annual_rate"])
    documents = [{"id": str(t.id), "key": t.template_key, "title": loan_stage.document_title(t.template_key),
                  "done": t.done, "due_date": t.due_date.isoformat() if t.due_date else None, "version": t.version}
                 for t in StudyTask.objects.filter(plan=plan, template_key__startswith=loan_stage.PREFIX).order_by("created_at")]
    data["loan_stage"] = {"documents": documents, "payouts": loan_stage.payout_records(plan),
                          "signed": loan_stage.signed(plan), "school_payee": payee_record(plan)}
    return {**data, "plan": services.plan_record(plan, services.home_currency(user))["plan"],
            "inputs": with_necessary_expenses(deepcopy(item.inputs), plan) if item else defaults(user, plan),
            "version": item.version if item else 0, "plan_version": plan.version,
            "stale": stale, "lifecycle": progress, "is_simulated": True}


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
    if previous is None and not set(facts) & {"available_funds", "support_amount", "principal"}:
        return
    inputs = deepcopy(previous.inputs) if previous else defaults(user, plan)
    if previous and previous.result.get("estimate", {}).get("school_key") not in (None, plan.school_key):
        fresh = defaults(user, plan)
        inputs.update(costs=[], payment_date=None, loan=fresh["loan"])
    for key in ("available_funds", "funds_currency"):
        if key in facts:
            inputs[key] = json_value(facts[key])
    currency = facts.get("funds_currency") or inputs["funds_currency"]
    with_necessary_expenses(inputs, plan)
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
    result = {"quotes": [], "draft": data.get("draft", False)}
    if not data.get("draft"):
        # The funds typed in the panel are the plan's funds too, so the full-course gap follows them.
        funds = inputs.get("available_funds")
        plan.available_funds = Decimal(funds) if funds not in (None, "") else None
        plan.funds_currency = (inputs.get("funds_currency") or "") if plan.available_funds is not None else ""
        plan.save(update_fields=["available_funds", "funds_currency", "updated_at"])
        projection = projections(entry, inputs, plan.years, plan.start_date)
        check = prequal.prequalify(inputs, projection["suggested_principal"])
        result.update(**projection, prequal=check, quotes=create_quotes(user, inputs, check, plan),
                      estimate=services.estimate(entry, plan.years, services.home_currency(user)))
    item = PlanningAssessment.objects.create(owner=user, plan=plan, version=data["expected_version"] + 1,
             plan_version=plan.version, inputs=inputs, result=json_value(result))
    audit(user, user, "planning.assessment_saved", item, {"version": item.version})
    if not data.get("draft"):
        from .drafts import remember
        remember(user, plan)  # the school's draft keeps the funds and loan last worked out
    return read(user)


def _withdraw_others(user, plan, keep):
    """Re-confirming with another loan (or none) withdraws the plan's earlier unsigned application."""
    apps = SimulatedApplication.objects.filter(owner=user, loan_id__in=plan_loans(plan),
                                               status__in=["DRAFT", "UNDER_REVIEW", "APPROVED"])
    for app in apps.exclude(loan_id=keep) if keep else apps:
        lending_applications.application_action(user, {"expected_version": app.version, "action": "cancel"}, app)


def confirm(user, data, obj=None):
    """The panel's one confirmation: the chosen simulated loan (if any) is submitted and the plan is confirmed together."""
    from django.db.models import F
    from django.utils import timezone

    from finance.agent_models import AgentPendingAction

    from . import guidance

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    require(plan.status == "DRAFT", "PLAN_NOT_DRAFT")
    item = latest(plan)
    check_versions(plan, item, data)
    from . import loan_stage

    _withdraw_others(user, plan, data.get("quote_id"))
    application = submit(user, data)["application"] if data.get("quote_id") else None
    services.confirm_plan(user, plan)
    if application is not None and application["status"] in ("APPROVED", "UNDER_REVIEW"):
        loan_stage.seed_documents(user, plan, (item.inputs if item else {}).get("borrower") or "student_with_parent")
    if item is not None:
        # The figures were just confirmed as they are, so the assessment stays current for the confirmed plan.
        PlanningAssessment.objects.filter(pk=item.pk).update(plan_version=plan.version)
    # A confirmation proposed in the chat is now settled; it can no longer confirm a second time.
    AgentPendingAction.objects.filter(owner=user, action="plan.confirm", target_id=plan.id,
                                      status="PENDING").update(status="EXPIRED", decided_at=timezone.now(),
                                                               version=F("version") + 1)
    guidance.append_confirmed(user, plan)
    return {**read(user), "application": application}


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
    active = [a for a in lifecycle(user, plan)["applications"] if a["status"] in ("UNDER_REVIEW", "APPROVED", "DISBURSED")]
    require(not active, "PLANNING_ACTIVE_APPLICATION")
    ensure_demo_state(user)
    if existing is None:
        created = lending_applications.create_application(user, {"quote_id": data["quote_id"]})
        existing = SimulatedApplication.objects.get(owner=user, pk=created["id"])
    result = planning_decision(user, existing, item.result.get("prequal") or {})
    return {"application": result, "assessment_version": item.version, "is_simulated": True}


def planning_decision(user, application, check):
    """A planning loan is approved (simulated) when it stays within the pre-check: no more than the full-course gap
    plus fees, and a first repayment still ahead. Monthly income is not part of the decision."""
    require(application.status == "DRAFT", "INVALID_STATE")
    lending_applications.ensure_future(application.loan)
    cap = check.get("max_principal")
    within = cap is not None and Decimal(application.loan.result["principal"]) <= Decimal(cap)
    application.assessment = {"status": "PREQUALIFIED" if within else "ABOVE_PREQUAL", "max_principal": cap}
    application.status = "APPROVED" if within else "REJECTED"
    audit(user, user, "application.SUBMITTED", application)
    return lending_applications.changed(application, user, "application." + application.status)
