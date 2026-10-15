"""Planning services: cost estimates, the chosen school and plan states (DRAFT, then CONFIRMED with the loan)."""

from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from finance import fx_rates, money
from finance.workflow_common import audit, require

from . import catalog
from .models import DISPLAY_CURRENCIES, ROLES, PlanningProfile, StudyPlan

LIVING = ("housing", "food", "transport", "communications")
ESSENTIALS = ("insurance", "visa", "deposit", "travel", "settlement", "study_materials")
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
    months = entry.school.duration_months
    if months:
        return months // 12 if months % 12 == 0 else months / 12
    return entry.school.duration_years or 1


def valid_years(years):
    return 1 <= years <= 6 and years * 2 == int(years * 2)


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
        require(valid_years(years), "YEARS_OUT_OF_RANGE")
    result = estimate_costs(entry, years)
    if home_currency and home_currency != entry.school.currency:
        result["converted"] = convert(result["total"], entry.school.currency, home_currency)
    return result


def school_sources(entry):
    """Where a catalog school's figures come from, for the cards and the school list (not for the model)."""
    return {"website": str(entry.school.website), "observed_at": entry.observed_at.isoformat(),
            "sources": [{"url": str(s.url), "title": s.title, "accessed": s.accessed.isoformat()} for s in entry.sources]}


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


def plan_costs(plan, home=None):
    """The plan's cost estimate: frozen at confirmation, else from the catalog; None once the school is gone."""
    if plan.status != "DRAFT" and plan.snapshot:
        return plan.snapshot
    entry = catalog.school(plan.school_key)
    return estimate(entry, plan.years, home) if entry else None


def course_total(plan):
    """{"total", "currency"} of the full course (the known part while lines are missing), or None."""
    costs = plan_costs(plan)
    return {"total": costs["total"], "currency": costs["currency"]} if costs else None


def plan_years(plan):
    return int(plan.years) if plan.years == int(plan.years) else plan.years


def plan_record(plan, home=None):
    if plan is None:
        return {"plan": None}
    entry = catalog.school(plan.school_key)
    result = {"id": str(plan.id), "status": plan.status, "school_key": plan.school_key,
              "years": plan_years(plan), "start_date": plan.start_date.isoformat(), "version": plan.version,
              "confirmed_at": plan.confirmed_at.isoformat() if plan.confirmed_at else None,
              "is_simulated": True}
    if entry is None:
        result["error"] = "SCHOOL_REMOVED_FROM_CATALOG"
        return {"plan": result}
    costs = plan_costs(plan, home)
    result["school"] = {"name": entry.school.name.model_dump(), "currency": entry.school.currency}
    result["total"], result["currency"] = costs["total"], costs["currency"]
    result["duration_months"] = costs.get("duration_months", round(plan.years * 12))
    result["complete"] = costs.get("complete", True)
    result["converted"] = costs.get("converted")
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
    require(plan is None or not _signed(plan), "PLAN_LOAN_SIGNED")
    withdrawn = False
    if plan is None:
        plan = StudyPlan(owner=user, school_key=entry.key, catalog_version=entry.version,
                         years=data.get("years") or default_years(entry), start_date=entry.calendar.start_date)
    else:
        if plan.school_key != entry.key:
            plan.loan = None  # a loan sized for another school no longer applies
            plan.school_payee = None  # nor does the other school's account
            withdrawn = _withdraw_applications(user, plan)
            plan.years = default_years(entry)  # another school's length does not carry over
        plan.school_key, plan.catalog_version = entry.key, entry.version
        plan.start_date = entry.calendar.start_date
        if data.get("years"):
            plan.years = data["years"]
        plan.version += 1
    require(valid_years(plan.years), "YEARS_OUT_OF_RANGE")
    # Any change reopens a confirmed plan for review.
    plan.status, plan.snapshot, plan.confirmed_at = "DRAFT", {}, None
    plan.save()
    _reopened(plan)
    from .assessment import remember_facts
    principal = remember_facts(user, plan, data)
    audit(user, user, "planning.plan_saved", plan, {"school_key": plan.school_key, "version": plan.version})
    from .drafts import remember
    remember(user, plan)
    # The loan amount said in the chat, as stored for the loan panel (THB), so the reply can repeat it.
    return {**plan_record(plan, home_currency(user)), "withdrawn_application": withdrawn,
            "loan_principal": principal}


def _signed(plan):
    from .loan_stage import signed
    return signed(plan)


def _withdraw_applications(user, plan):
    """A loan applied for one school does not carry over to another: open applications are withdrawn.

    A signed loan (paid out to the school) cannot be withdrawn, so the school cannot change any more."""
    from finance.lending_applications import application_action
    from finance.workflow_models import SimulatedApplication

    from .assessment import plan_loans

    apps = SimulatedApplication.objects.filter(owner=user, loan_id__in=plan_loans(plan),
                                               status__in=["DRAFT", "UNDER_REVIEW", "APPROVED", "DISBURSED"])
    require(not apps.filter(status="DISBURSED").exists(), "PLAN_LOAN_SIGNED")
    open_apps = list(apps)
    for app in open_apps:
        application_action(user, {"expected_version": app.version, "action": "cancel"}, app)
    return bool(open_apps)


def confirm_plan(user, plan):
    require(plan.status == "DRAFT", "PLAN_NOT_DRAFT")
    entry = entry_or_404(plan.school_key)
    plan.snapshot = estimate(entry, plan.years, home_currency(user))
    plan.status, plan.confirmed_at = "CONFIRMED", timezone.now()
    plan.version += 1
    plan.save()
    # Deposits, the first tuition and the visa fall due before arrival, so bills and the
    # arrival checklist start with the confirmed plan.
    from . import checklist
    from .in_school import generate_bills

    from .payees import school_payee

    generate_bills(user, plan)
    checklist.seed(user, plan)
    school_payee(plan)
    audit(user, user, "planning.plan_confirmed", plan, {"version": plan.version})
    return plan_record(plan)


def _reopened(plan):
    """A confirmed plan reopened for changes drops what it generated; paid bills and finished items stay."""
    from . import checklist
    from .models import PlanBill

    PlanBill.objects.filter(plan=plan, status="DUE").delete()
    checklist.clear(plan)


def first_month(plan):
    """The first month after arrival, from the school's sample costs: what is spent every month, the one-off
    arrival costs, and the bills already due at the start (those are in This month, not counted again)."""
    entry = catalog.school(plan.school_key)
    if entry is None:
        return None
    lines = [l for l in estimate(entry, plan.years)["lines"] if l.get("amount") is not None]
    row = lambda l: {"label": l["label"], "amount": l["amount"]}
    monthly = [row(l) for l in lines if l["period"] == "month" and l["start_month"] == 0]
    one_off = [row(l) for l in lines if l["period"] == "once" and l["start_month"] == 0 and l["category"] != "tuition"]
    from .in_school import BILLED
    bills = [row(l) for l in lines if l["category"] in BILLED and l["start_month"] == 0
             and (l["period"] in ("semester", "year") or l["category"] == "tuition")]
    total = lambda rows: _s(sum((Decimal(r["amount"]) for r in rows), Decimal(0)))
    return {"currency": entry.school.currency, "monthly": monthly, "monthly_total": total(monthly),
            "one_off": one_off, "one_off_total": total(one_off),
            "first_month_total": _s(Decimal(total(monthly)) + Decimal(total(one_off))),
            "bills_at_start": bills, "bills_at_start_total": total(bills), "sample": True}
