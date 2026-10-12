"""Planning services: cost estimates, the funding gap, loan simulation and plan states."""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from finance import fx_rates, money
from finance.workflow_common import audit, require

from . import catalog
from .models import PlanningProfile, StudyPlan

LIVING = ("housing", "food", "transport", "communications")
ESSENTIALS = ("insurance", "visa", "deposit", "travel", "settlement", "study_materials")
ENROLLMENT_NOTICE_DAYS = 3
DEFAULT_LOAN = {"months": 48, "annual_rate": "0.06"}
CENT = Decimal(".01")


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
    """Totals for `years` academic years: one-off costs once, recurring costs every year."""
    years = years or default_years(entry)
    require(1 <= years <= 6, "YEARS_OUT_OF_RANGE")
    lines, totals = [], {"low": Decimal(0), "typical": Decimal(0), "high": Decimal(0)}
    groups = {g: Decimal(0) for g in ("tuition", "living", "essentials")}
    first_year = Decimal(0)
    per_year_count = {**catalog.PER_YEAR, "semester": entry.calendar.semesters_per_year}
    for cost in entry.costs:
        low, typical, high = _bounds(cost)
        per_year = typical * per_year_count[cost.period]
        count = 1 if cost.period == "once" else per_year_count[cost.period] * years
        for name, value in (("low", low), ("typical", typical), ("high", high)):
            totals[name] += value * count
        groups[_group(cost.category)] += typical * count
        first_year += typical * (1 if cost.period == "once" else per_year_count[cost.period])
        lines.append({"cost_id": cost.cost_id, "category": cost.category, "group": _group(cost.category),
                      "label": cost.label.model_dump(), "period": cost.period, "amount": _s(typical),
                      "lower": cost.lower, "upper": cost.upper, "per_year": _s(per_year),
                      "total": _s(typical * count), "estimate": cost.estimate,
                      "source_url": str(cost.source_url) if cost.source_url else None})
    currency = entry.school.currency
    result = {"school_key": entry.key, "catalog_version": entry.version, "currency": currency,
              "years": years, "lines": lines, "groups": {k: _s(v) for k, v in groups.items()},
              "first_year": _s(first_year), "total": _s(totals["typical"]),
              "total_low": _s(totals["low"]), "total_high": _s(totals["high"]),
              "estimated_share": _s(sum(Decimal(l["total"]) for l in lines if l["estimate"])
                                    / totals["typical"] * 100 if totals["typical"] else 0),
              "sample": True}
    if home_currency and home_currency != currency:
        result["converted"] = convert(totals["typical"], currency, home_currency)
    return result


def school_brief(entry, home_currency=None):
    """Compact summary for tool results and lists."""
    first = estimate(entry, 1)
    tuition = sum((Decimal(l["per_year"]) for l in first["lines"] if l["category"] == "tuition"), Decimal(0))
    living = sum((Decimal(l["per_year"]) for l in first["lines"] if l["group"] == "living"), Decimal(0))
    brief = {"key": entry.key, "name": entry.school.name.model_dump(), "country": entry.school.country.model_dump(),
             "city": entry.school.city.model_dump(), "currency": entry.school.currency,
             "program": entry.school.program.model_dump(), "duration_years": default_years(entry),
             "intake": entry.calendar.intake, "start_date": entry.calendar.start_date.isoformat(),
             "tuition_per_year": _s(tuition), "living_per_year": _s(living),
             "first_year_total": first["first_year"], "sample": True}
    if home_currency and home_currency != entry.school.currency:
        brief["first_year_converted"] = convert(first["first_year"], entry.school.currency, home_currency)
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


def set_role(user, data):
    home = (data.get("home_currency") or "").upper()
    if home:
        money.require_supported(home)
    item, _ = PlanningProfile.objects.get_or_create(owner=user, defaults={"role": data["role"]})
    item.role = data["role"]
    if home:
        item.home_currency = home
    item.save()
    audit(user, user, "planning.role_set", item, {"role": item.role})
    return profile_record(item)


def profile_record(item):
    if item is None:
        return {"role": None, "home_currency": "CNY"}
    return {"role": item.role, "home_currency": item.home_currency}


def home_currency(user):
    item = profile(user)
    return item.home_currency if item else "CNY"


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
    return {**plan_record(plan, home_currency(user)), "gap": gap, "gap_currency": entry.school.currency,
            "principal_fx": principal}


def confirm_plan(user, plan):
    require(plan.status == "DRAFT", "PLAN_NOT_DRAFT")
    entry = entry_or_404(plan.school_key)
    plan.snapshot = estimate(entry, plan.years, home_currency(user))
    plan.status, plan.confirmed_at = "CONFIRMED", timezone.now()
    plan.version += 1
    plan.save()
    audit(user, user, "planning.plan_confirmed", plan, {"version": plan.version})
    return plan_record(plan)


def enroll(user, plan):
    require(plan.status == "CONFIRMED", "PLAN_NOT_CONFIRMED")
    from .in_school import generate_bills

    plan.status, plan.enrolled_at = "ENROLLED", timezone.now()
    plan.version += 1
    plan.save()
    generate_bills(user, plan)
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
    role = profile(parent)
    require(role is None or role.role == "parent", "PARENT_ROLE_REQUIRED")
    if role is None:
        set_role(parent, {"role": "parent"})
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
