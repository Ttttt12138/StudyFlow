"""Planning tools for the agent (registered in finance/agent_tools.py)."""

from decimal import Decimal

from rest_framework import serializers as s

from finance.workflow_serializers import Input

from . import catalog, in_school, services
from .models import EXPENSE_CATEGORIES


class Empty(Input):
    pass


class SchoolFilter(Input):
    country_code = s.CharField(max_length=2, required=False)


class SchoolRef(Input):
    school_key = s.CharField(max_length=60)


class CompareInput(Input):
    school_keys = s.ListField(child=s.CharField(max_length=60), min_length=2, max_length=4)


class EstimateInput(Input):
    school_key = s.CharField(max_length=60)
    years = s.IntegerField(min_value=1, max_value=6, required=False)


class PlanInput(Input):
    school_key = s.CharField(max_length=60)
    years = s.IntegerField(min_value=1, max_value=6, required=False)
    available_funds = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)
    funds_currency = s.CharField(max_length=3, required=False)
    monthly_income = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)
    monthly_expenses = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)
    existing_repayments = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)
    support_amount = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)
    support_date = s.DateField(required=False)
    principal = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)
    monthly_income_currency = s.CharField(max_length=3, required=False)
    monthly_expenses_currency = s.CharField(max_length=3, required=False)
    existing_repayments_currency = s.CharField(max_length=3, required=False)
    support_currency = s.CharField(max_length=3, required=False)
    principal_currency = s.CharField(max_length=3, required=False)


class ExpenseInput(Input):
    amount = s.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal("0.01"))
    currency = s.CharField(max_length=3, required=False)
    category = s.ChoiceField(choices=EXPENSE_CATEGORIES, required=False)
    note = s.CharField(max_length=200, required=False, allow_blank=True)
    spent_on = s.DateField(required=False)


class MonthInput(Input):
    month = s.CharField(max_length=7, required=False)


class LoanInput(Input):
    months = s.IntegerField(min_value=6, max_value=60, required=False)
    principal = s.DecimalField(max_digits=16, decimal_places=2, min_value=1, required=False)


def filtered_schools(data):
    return [e for e in catalog.schools()
            if not data.get("country_code") or e.school.country_code == data["country_code"].upper()]


def _schools(user, data):
    """Compact rows so ten schools stay within the planner's result budget; the card has the rest."""
    home = services.home_currency(user)
    rows = []
    for entry in filtered_schools(data):
        brief = services.school_brief(entry, home)
        converted = brief.get("first_year_converted") or {}
        total_home = brief.get("total_converted") or {}
        rows.append({"key": brief["key"], "name": brief["name"], "country": brief["country"],
                     "currency": brief["currency"], "duration_years": brief["duration_years"],
                     "first_year_total": brief["first_year_total"],
                     "first_year_home": converted.get("amount"), "home_currency": converted.get("currency"),
                     "total": brief["total"], "total_home": total_home.get("amount")})
    return {"schools": rows, "sample": True}


def _profile(user, data):
    return services.school_profile(services.entry_or_404(data["school_key"]))


def _compare(user, data):
    """Each school's full-course total (and in the home currency), cheapest first in `cheapest`."""
    home = services.home_currency(user)
    keys = list(dict.fromkeys(data["school_keys"]))
    rows = [services.school_brief(services.entry_or_404(k), home) for k in keys]
    comparable = [r for r in rows if r["currency"] == home or r.get("total_converted")]
    cheapest = None
    if len(comparable) == len(rows) and all(r.get("complete") for r in rows):
        def home_total(row):
            return Decimal(row["total"] if row["currency"] == home else row["total_converted"]["amount"])
        cheapest = min(rows, key=home_total)["key"]
    return {"schools": rows, "home_currency": home, "cheapest": cheapest, "sample": True}


def _estimate(user, data):
    entry = services.entry_or_404(data["school_key"])
    result = services.estimate(entry, data.get("years"), services.home_currency(user))
    # The planner gets totals; the card shows every line.
    return {k: v for k, v in result.items() if k != "lines"} | {"line_count": len(result["lines"])}


def _get_plan(user, data):
    return {**services.plan_record(services.plan_for(user), services.home_currency(user)),
            "profile": services.profile_record(services.profile(user))}


def _save_plan(user, data):
    return services.save_plan(user, data)


def _loan(user, data):
    return {**_get_plan(user, data), "open_assessment": True}


def _confirm_plan(user, data):
    from finance.agent_tools import Proposal
    from finance.workflow_common import require

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    require(plan.status == "DRAFT", "PLAN_NOT_DRAFT")
    record = services.plan_record(plan, services.home_currency(user))["plan"]
    return Proposal("plan.confirm", plan.id, None, "", {
        "plan_id": str(plan.id), "school_key": plan.school_key, "years": plan.years,
        "total": record.get("total"), "currency": record.get("currency"), "gap": record.get("gap")})


def _confirm_enrollment(user, data):
    from finance.agent_tools import Proposal
    from finance.workflow_common import require

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    require(plan.status == "CONFIRMED", "PLAN_NOT_CONFIRMED")
    return Proposal("plan.enroll", plan.id, None, "", {
        "plan_id": str(plan.id), "school_key": plan.school_key, "start_date": plan.start_date.isoformat()})


def _bills(user, data):
    return {"bills": in_school.bills(user, upcoming_only=True, limit=12)}


def _record_expense(user, data):
    return in_school.record_expense(user, data, via_agent=True)


def _spending(user, data):
    return in_school.spending(user, data.get("month"))


def _study_life(user, data):
    from . import life
    result = life.read(user)
    return {key: result[key] for key in ("today", "upcoming", "attention_count", "in_app_only")}


HINTS = {
    "school_key": "key of a school from list_schools (not its name)",
    "school_keys": "2-4 keys of schools from list_schools",
    "years": "academic years to cover; omit to use the programme length",
    "available_funds": "decimal string of savings the family already has for study",
    "funds_currency": "currency of available_funds; omit to use the home currency",
    "amount": "decimal string the user says they spent",
    "currency": "currency the user names; omit to use the plan currency",
    "category": "food, transport, housing, study, shopping, fun, health or other",
    "note": "what was bought, in the user's words",
    "month": "YYYY-MM; omit for the current month",
}


def tools(Tool):
    from .life_inputs import StudyTaskInput
    from . import life_commands
    return [
        Tool("create_study_task", "T1", "Save a user-requested in-app reminder. Preserve the original source text. "
             "Dates are user-supplied; use null when unknown. Never invent official deadlines.", StudyTaskInput, life_commands.create_task),
        Tool("get_study_life", "T0", "Current in-app tasks, enrollment and payment reminders; next actual loan installment and monthly budget.",
             Empty, _study_life),
        Tool("list_schools", "T0", "Sample catalog schools with first-year and full-course cost in local and home "
             "currency.",
             SchoolFilter, _schools),
        Tool("get_school_profile", "T0", "One school's programme, facilities, food nearby and places to visit.",
             SchoolRef, _profile),
        Tool("compare_schools", "T0", "Compare 2-4 schools: tuition, living, first-year and full-course "
             "totals (also in the home currency) and the cheapest overall.",
             CompareInput, _compare),
        Tool("estimate_total_cost", "T0", "Tuition, living and essential costs for a school over N years, "
             "with totals and a home-currency conversion.", EstimateInput, _estimate),
        Tool("get_plan", "T0", "The user's study plan (school, totals, funds, gap, loan) and display currency.", Empty, _get_plan),
        Tool("save_plan", "T1", "Choose a school for the plan and record years and available funds; "
             "returns the funding gap.", PlanInput, _save_plan),
        Tool("simulate_loan", "T1", "Open the combined loan assessment. It does not create a quote or application; "
             "the user reviews amounts and repayment assumptions in the panel.", LoanInput, _loan),
        Tool("confirm_plan", "T2", "Propose confirming the study plan; the user must confirm.", Empty, _confirm_plan),
        Tool("list_bills", "T0", "Upcoming in-school bills (tuition, housing, insurance, loan installments).",
             Empty, _bills),
        Tool("record_expense", "T1", "Record day-to-day spending for an enrolled student.", ExpenseInput,
             _record_expense),
        Tool("get_spending", "T0", "A month's spending by category against the monthly living budget.",
             MonthInput, _spending),
        Tool("confirm_enrollment", "T2", "Propose marking the student as enrolled; the user must confirm.",
             Empty, _confirm_enrollment),
    ]
