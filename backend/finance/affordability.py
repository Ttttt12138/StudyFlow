from collections import defaultdict
from decimal import Decimal

from .lending_core.calculations import assess as assess_quote
from .lending_core.schemas import MonthBudget
from .lending_models import AffordabilityProfile, LoanInstallment
from .services import VersionConflict, json_value
from .workflow_common import append_state, audit, current, record
from .workflow_models import SimulatedApplication


def save_profile(actor, data, obj=None):
    profile = AffordabilityProfile.objects.filter(owner=actor).first()
    if data["expected_version"] != (profile.version if profile else 0):
        raise VersionConflict()
    if profile is None:
        profile = AffordabilityProfile(owner=actor, version=0)
    profile.months = json_value(data["months"])
    profile.version += 1
    profile.save()
    append_state(actor, current(actor).snapshot, actor, "state.lending_profile_changed")
    audit(
        actor, actor, "lending.profile_updated", profile, {"version": profile.version}
    )
    return record(profile)


def commitments(application):
    totals = defaultdict(Decimal)
    others = SimulatedApplication.objects.filter(
        owner=application.owner, status__in=["APPROVED", "DISBURSED"]
    )
    for other in others.exclude(pk=application.pk).select_related("loan"):
        installments = LoanInstallment.objects.filter(
            account__disbursement__application=other
        )
        if installments.exists():
            rows = [
                (item.due_on.isoformat(), item.amount)
                for item in installments.filter(paid_on__isnull=True)
            ]
        else:
            rows = [
                (row["due_date"], Decimal(row["payment"]))
                for row in other.loan.result["schedule"]
            ]
        for due, amount in rows:
            totals[due[:7]] += amount
    return totals


def assess(application):
    profile = AffordabilityProfile.objects.filter(owner=application.owner).first()
    budgets = (
        [MonthBudget.model_validate(row) for row in profile.months] if profile else []
    )
    repayments = [
        {"due_date": row["due_date"], "amount": row["payment"]}
        for row in application.loan.result["schedule"]
        if Decimal(row["payment"]) > 0
    ]
    result = assess_quote({"repayments": repayments}, budgets, commitments(application))
    result["profile_version"] = profile.version if profile else 0
    return result
