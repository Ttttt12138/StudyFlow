"""Planning tools for the agent (registered in finance/agent_tools.py)."""

from decimal import Decimal

from rest_framework import serializers as s

from finance.workflow_serializers import Input

from . import catalog, in_school, services
from .models import EXPENSE_CATEGORIES, ROLES


class Empty(Input):
    pass


class RoleInput(Input):
    role = s.ChoiceField(choices=ROLES)
    home_currency = s.CharField(max_length=3, required=False)


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


def _role(user, data):
    return services.set_role(user, data)


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
        rows.append({"key": brief["key"], "name": brief["name"], "country": brief["country"],
                     "currency": brief["currency"], "duration_years": brief["duration_years"],
                     "first_year_total": brief["first_year_total"],
                     "first_year_home": converted.get("amount"), "home_currency": converted.get("currency")})
    return {"schools": rows, "sample": True}


def _profile(user, data):
    return services.school_profile(services.entry_or_404(data["school_key"]))


def _compare(user, data):
    home = services.home_currency(user)
    keys = list(dict.fromkeys(data["school_keys"]))
    return {"schools": [services.school_brief(services.entry_or_404(k), home) for k in keys],
            "home_currency": home, "sample": True}


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
    return services.simulate_loan(user, data)


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


HINTS = {
    "school_key": "key of a school from list_schools (not its name)",
    "school_keys": "2-4 keys of schools from list_schools",
    "role": "parent when a parent/guardian plans for a child; student when the student plans",
    "home_currency": "currency the family thinks in, e.g. CNY",
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
    return [
        Tool("set_role", "T1", "Record whether the user is a parent or a student (and their home currency).",
             RoleInput, _role),
        Tool("list_schools", "T0", "Sample catalog schools with first-year cost in local and home currency.",
             SchoolFilter, _schools),
        Tool("get_school_profile", "T0", "One school's programme, facilities, food nearby and places to visit.",
             SchoolRef, _profile),
        Tool("compare_schools", "T0", "Compare 2-4 schools: tuition, living and first-year total.",
             CompareInput, _compare),
        Tool("estimate_total_cost", "T0", "Tuition, living and essential costs for a school over N years, "
             "with totals and a home-currency conversion.", EstimateInput, _estimate),
        Tool("get_plan", "T0", "The user's study plan (school, totals, funds, gap, loan) and role.", Empty, _get_plan),
        Tool("save_plan", "T1", "Choose a school for the plan and record years and available funds; "
             "returns the funding gap.", PlanInput, _save_plan),
        Tool("simulate_loan", "T1", "Simulate a THB loan that covers the plan's funding gap.", LoanInput, _loan),
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
