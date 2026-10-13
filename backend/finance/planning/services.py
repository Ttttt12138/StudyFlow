"""Planning services: cost estimates, the funding gap, loan simulation and plan states."""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from finance import fx_rates, money
from finance.workflow_common import audit, require

from . import catalog
from .models import DISPLAY_CURRENCIES, ROLES, PlanningProfile, StudyPlan

LIVING = ("housing", "food", "transport", "communications")
ESSENTIALS = ("insurance", "visa", "deposit", "travel", "settlement", "study_materials")
ENROLLMENT_NOTICE_DAYS = 3
DEFAULT_LOAN = {"months": 48, "annual_rate": "0.06"}
CENT = Decimal(".01")
DEFAULT_DISPLAY_CURRENCY = "THB"


def _q(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _s(value):
    return format(_q(value), "f")


def entry_or_404(key):
    entry = catalog.school(key)
    require(entry is not None, "UNKNOWN_SCHOOL")
    return entry


def default_years(entry):
    return entry.school.duration_years or 1


def today_for(user):
    from finance.lending_applications import business_date

    return business_date(user)


def _bounds(cost):
    low = Decimal(cost.lower if cost.lower is not None else cost.amount)
    high = Decimal(cost.upper if cost.upper is not None else cost.amount)
    return low, cost.typical(), high


def _group(category):
    if category == "tuition":
        return "tuition"
    return "living" if category in LIVING else "essentials"


def convert(amount, source, target):
    """Indicative conversion with the rate's date and source; None when no rate is available."""
    if source == target:
        return {"currency": target, "amount": _s(amount), "rate": "1", "rate_date": None, "source": None}
    try:
        rate = fx_rates.get_rate(source, target)
    except Exception:  # noqa: BLE001 - FX outages must not block a plan; the card shows no conversion
        return None
    value = money.quantize(Decimal(amount) * Decimal(rate["rate"]), target)
    return {"currency": target, "amount": money.fmt(value, target), "rate": rate["rate"],
            "rate_date": rate.get("rate_date"), "source": rate.get("source")}


def estimate(entry, years=None, home_currency=None):
    from .costs import estimate as estimate_costs

    if years is not None:
        require(1 <= years <= 6, "YEARS_OUT_OF_RANGE")
    result = estimate_costs(entry, years)
    if home_currency and home_currency != entry.school.currency:
        result["converted"] = convert(result["total"], entry.school.currency, home_currency)
    return result


def school_brief(entry, home_currency=None):
    """Compact summary for tool results and lists: first-year figures and the full-course total."""
    first = estimate(entry, 1)
    full = estimate(entry)
    tuition = sum((Decimal(l["per_year"]) for l in first["lines"] if l["category"] == "tuition" and l["per_year"] is not None), Decimal(0))
    living = sum((Decimal(l["per_year"]) for l in first["lines"] if l["group"] == "living" and l["per_year"] is not None), Decimal(0))
    brief = {"key": entry.key, "name": entry.school.name.model_dump(), "country": entry.school.country.model_dump(),
             "city": entry.school.city.model_dump(), "currency": entry.school.currency,
             "program": entry.school.program.model_dump(), "duration_years": default_years(entry),
             "intake": entry.calendar.intake, "start_date": entry.calendar.start_date.isoformat(),
             "tuition_per_year": _s(tuition), "living_per_year": _s(living),
             "first_year_total": first["first_year"], "years": full["years"], "total": full["total"],
             "complete": full["complete"], "missing_cost_ids": full["missing_cost_ids"],
             "duration_months": full["duration_months"], "observed_at": full["observed_at"],
             "total_low": full["total_low"], "total_high": full["total_high"], "sample": True}
    if home_currency and home_currency != entry.school.currency:
        brief["first_year_converted"] = convert(first["first_year"], entry.school.currency, home_currency)
        brief["total_converted"] = convert(full["total"], entry.school.currency, home_currency)
    return brief


def school_profile(entry):
    """Facilities, food and places, trimmed for the planner; cards carry the full entry."""
    def places(rows):
        return [{"name": p.name.model_dump(), "kind": p.kind, "distance_km": p.distance_km,
                 "typical_cost": p.typical_cost} for p in rows]

    return {**school_brief(entry), "website": str(entry.school.website), "language": entry.school.language,
            "facilities": places(entry.facilities), "food": places(entry.food),
            "attractions": places(entry.attractions)}


# -- profile and plan -------------------------------------------------------------------------

def profile(user):
    return PlanningProfile.objects.filter(owner=user).first()


def set_profile(user, data):
    """Create or update the planning profile; only the display currency matters now."""
    home = (data.get("home_currency") or "").upper()
    if home:
        require(home in DISPLAY_CURRENCIES, "CURRENCY_NOT_SUPPORTED")
    role = data.get("role")
    item, _ = PlanningProfile.objects.get_or_create(owner=user)
    if role in ("", *ROLES):  # legacy field, accepted but never asked for
        item.role = role
    if home:
        item.home_currency = home
    item.save()
    audit(user, user, "planning.profile_set", item, {"home_currency": item.home_currency})
    return profile_record(item)


set_role = set_profile  # older callers


def profile_record(item):
    if item is None:
        return {"role": None, "home_currency": DEFAULT_DISPLAY_CURRENCY}
    return {"role": item.role or None, "home_currency": item.home_currency}


def home_currency(user):
    item = profile(user)
    return item.home_currency if item else DEFAULT_DISPLAY_CURRENCY


def display_rates():
    """Indicative THB value of one unit of each display and catalog currency."""
    currencies = list(DISPLAY_CURRENCIES)
    for entry in catalog.schools():
        if entry.school.currency not in currencies:
            currencies.append(entry.school.currency)
    rates, rate_date, source = {}, None, None
    for currency in currencies:
        if currency == "THB":
            rates[currency] = "1"
            continue
        try:
            rate = fx_rates.get_rate(currency, "THB")
        except Exception:  # noqa: BLE001 - one missing rate must not hide the others
            continue
        rates[currency] = str(rate["rate"])
        rate_date = rate_date or rate.get("rate_date")
        source = source or rate.get("source")
    return {"currencies": list(DISPLAY_CURRENCIES), "thb_per_unit": rates,
            "rate_date": str(rate_date) if rate_date else None, "source": source, "is_simulated": True}


def plan_for(user):
    return StudyPlan.objects.filter(owner=user).first()


def funding(plan, entry, estimate_result):
    """Available funds in the school currency and the remaining gap."""
    total = Decimal(estimate_result["total"])
    if plan.available_funds is None:
        return {"available": None, "gap": None}
    funds = Decimal(plan.available_funds)
    if plan.funds_currency and plan.funds_currency != entry.school.currency:
        converted = convert(funds, plan.funds_currency, entry.school.currency)
        if converted is None:
            return {"available": None, "gap": None, "error": "FX_RATE_UNAVAILABLE"}
        funds = Decimal(converted["amount"])
    return {"available": _s(funds), "gap": _s(max(total - funds, Decimal(0)))}


def plan_record(plan, home=None):
    if plan is None:
        return {"plan": None}
    entry = catalog.school(plan.school_key)
    result = {"id": str(plan.id), "status": plan.status, "school_key": plan.school_key,
              "years": plan.years, "start_date": plan.start_date.isoformat(), "version": plan.version,
              "available_funds": _s(plan.available_funds) if plan.available_funds is not None else None,
              "funds_currency": plan.funds_currency or None,
              "confirmed_at": plan.confirmed_at.isoformat() if plan.confirmed_at else None,
              "enrolled_at": plan.enrolled_at.isoformat() if plan.enrolled_at else None,
              "is_simulated": True}
    if entry is None:
        result["error"] = "SCHOOL_REMOVED_FROM_CATALOG"
        return {"plan": result}
    costs = plan.snapshot if plan.status != "DRAFT" and plan.snapshot else estimate(entry, plan.years, home)
    result["school"] = {"name": entry.school.name.model_dump(), "currency": entry.school.currency}
    result["total"], result["currency"] = costs["total"], costs["currency"]
    result["duration_months"] = costs.get("duration_months", plan.years * 12)
    result["complete"] = costs.get("complete", True)
    result["converted"] = costs.get("converted")
    result.update(funding(plan, entry, costs))
    if plan.loan_id:
        loan = plan.loan.result
        result["loan"] = {"id": str(plan.loan_id), "currency": "THB", "principal": loan.get("principal"),
                          "months": plan.loan.inputs.get("months"), "annual_rate": plan.loan.inputs.get("annual_rate"),
                          "monthly_payment": loan.get("maximum_installment"),
                          "total_repayment": loan.get("total_repayment")}
    return {"plan": result}


def save_plan(user, data):
    entry = entry_or_404(data["school_key"])
    plan = plan_for(user)
    require(plan is None or plan.status != "ENROLLED", "PLAN_ALREADY_ENROLLED")
    funds = data.get("available_funds")
    currency = (data.get("funds_currency") or "").upper()
    if funds is not None:
        require(Decimal(funds) >= 0, "FUNDS_MUST_BE_NONNEGATIVE")
        currency = currency or home_currency(user)
        money.require_supported(currency)
    if plan is None:
        plan = StudyPlan(owner=user, school_key=entry.key, catalog_version=entry.version,
                         years=data.get("years") or default_years(entry), start_date=entry.calendar.start_date)
    else:
        if plan.school_key != entry.key:
            plan.loan = None  # a loan sized for another school no longer applies
        plan.school_key, plan.catalog_version = entry.key, entry.version
        plan.start_date = entry.calendar.start_date
        if data.get("years"):
            plan.years = data["years"]
        plan.version += 1
    require(1 <= plan.years <= 6, "YEARS_OUT_OF_RANGE")
    if funds is not None:
        plan.available_funds, plan.funds_currency = _q(funds), currency
    # Any change reopens a confirmed plan for review.
    plan.status, plan.snapshot, plan.confirmed_at = "DRAFT", {}, None
    plan.save()
    _reopened(plan)
    from .assessment import remember_facts
    remember_facts(user, plan, data)
    audit(user, user, "planning.plan_saved", plan, {"school_key": plan.school_key, "version": plan.version})
    return plan_record(plan, home_currency(user))


def simulate_loan(user, data):
    from finance.budget_services import create_loan
    from finance.workflow_models import LoanSimulation

    plan = plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    require(plan.status != "ENROLLED", "PLAN_ALREADY_ENROLLED")
    entry = entry_or_404(plan.school_key)
    gap = funding(plan, entry, estimate(entry, plan.years)).get("gap")
    require(gap is not None, "AVAILABLE_FUNDS_REQUIRED")
    require(Decimal(gap) > 0, "NO_FUNDING_GAP")
    # The simulated lending core settles in THB only (config/settings.py).
    principal = convert(gap, entry.school.currency, "THB")
    require(principal is not None, "FX_RATE_UNAVAILABLE")
    if data.get("principal"):
        principal = {**principal, "amount": _s(min(Decimal(data["principal"]), Decimal(principal["amount"])))}
    first_due = max(plan.start_date, today_for(user)) + timedelta(days=30)
    loan = create_loan(user, {"currency": "THB", "principal": principal["amount"],
                              "annual_rate": data.get("annual_rate") or DEFAULT_LOAN["annual_rate"],
                              "fees": "0.00", "months": data.get("months") or DEFAULT_LOAN["months"],
                              "first_due_date": first_due})
    plan.loan = LoanSimulation.objects.get(owner=user, pk=loan["id"])
    plan.status, plan.snapshot, plan.confirmed_at = "DRAFT", {}, None
    plan.version += 1
    plan.save()
    _reopened(plan)
    return {**plan_record(plan, home_currency(user)), "gap": gap, "gap_currency": entry.school.currency,
            "principal_fx": principal}


def confirm_plan(user, plan):
    require(plan.status == "DRAFT", "PLAN_NOT_DRAFT")
    entry = entry_or_404(plan.school_key)
    plan.snapshot = estimate(entry, plan.years, home_currency(user))
    plan.status, plan.confirmed_at = "CONFIRMED", timezone.now()
    plan.version += 1
    plan.save()
    # Deposits, the first tuition and the visa fall due before arrival, so bills and the
    # arrival checklist start with the confirmed plan rather than at enrollment.
    from . import checklist
    from .in_school import generate_bills

    generate_bills(user, plan)
    checklist.seed(user, plan)
    audit(user, user, "planning.plan_confirmed", plan, {"version": plan.version})
    return plan_record(plan)


def _reopened(plan):
    """A confirmed plan reopened for changes drops what it generated; paid bills and finished items stay."""
    from . import checklist
    from .models import PlanBill

    PlanBill.objects.filter(plan=plan, status="DUE").delete()
    checklist.clear(plan)


def enroll(user, plan):
    require(plan.status == "CONFIRMED", "PLAN_NOT_CONFIRMED")
    from .in_school import generate_bills

    plan.status, plan.enrolled_at = "ENROLLED", timezone.now()
    plan.version += 1
    plan.save()
    # Plans confirmed before bills moved to confirmation get them now; existing rows are kept.
    generate_bills(user, plan)
    # Confirming enrollment is the student saying registration is done.
    from .models import StudyTask
    StudyTask.objects.filter(plan=plan, template_key="registration", done=False).update(done=True)
    audit(user, user, "planning.enrolled", plan, {"version": plan.version})
    return plan_record(plan)


def enrollment_due(user, plan, today=None):
    """The agent proposes enrollment from three days before the start date."""
    if plan is None or plan.status != "CONFIRMED":
        return False
    today = today or today_for(user)
    return today >= plan.start_date - timedelta(days=ENROLLMENT_NOTICE_DAYS)


def days_until(start: date, today: date):
    return (start - today).days


# -- family links -----------------------------------------------------------------------------

def link_family(parent, raw_token):
    """A signed-in parent links to the student whose sponsor link they hold and confirmed."""
    from django.db import IntegrityError

    from finance.sponsorship import lookup_token

    from .models import FamilyLink

    item = lookup_token(raw_token)
    require(item.status == "CONFIRMED", "SPONSOR_LINK_NOT_CONFIRMED")
    require(item.owner_id != parent.pk, "CANNOT_LINK_OWN_ACCOUNT")
    link = FamilyLink.objects.filter(student_id=item.owner_id, parent=parent).first()
    if link is None:
        try:
            link = FamilyLink.objects.create(student_id=item.owner_id, parent=parent, sponsor_request=item)
        except IntegrityError:
            link = FamilyLink.objects.get(student_id=item.owner_id, parent=parent)
        audit(item.owner, parent, "planning.family_linked", item, {"parent_id": parent.pk})
    return link_record(link, parent)


def link_record(link, viewer):
    other = link.student if link.parent_id == viewer.pk else link.parent
    result = {"id": link.pk, "relation": "child" if link.parent_id == viewer.pk else "parent",
              "account": other.get_username(), "created_at": link.created_at.isoformat()}
    if link.parent_id == viewer.pk:
        from .in_school import summary

        # Parents see the student's plan, upcoming bills and spending totals read-only;
        # individual expense notes stay private to the student.
        result["plan"] = plan_record(plan_for(link.student), home_currency(viewer))["plan"]
        result["in_school"] = summary(link.student, detail=False)
    return result


def links(user):
    from django.db.models import Q

    from .models import FamilyLink

    rows = FamilyLink.objects.filter(Q(parent=user) | Q(student=user)).select_related("parent", "student")
    return [link_record(link, user) for link in rows.order_by("created_at")]
