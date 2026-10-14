"""B's application rules using the Django owner lock and shared transaction."""

from datetime import date
from decimal import Decimal

from django.utils import timezone

from .affordability import assess
from .services import VersionConflict
from .workflow_common import append_state, audit, current, owned, record, require
from .workflow_models import (
    DemoWallet,
    Disbursement,
    LoanSimulation,
    SimulatedApplication,
)


def business_date(owner):
    from .planning.models import PlanningProfile
    wallet = DemoWallet.objects.filter(owner=owner).first()
    if wallet:
        return wallet.clock
    demo_date = PlanningProfile.objects.filter(owner=owner).values_list("demo_date", flat=True).first()
    return demo_date or timezone.localdate()


def ensure_future(loan):
    first = next(row for row in loan.result["schedule"] if row["payment"] != "0.00")
    require(
        date.fromisoformat(first["due_date"]) > business_date(loan.owner),
        "QUOTE_EXPIRED",
    )


def check_version(obj, data):
    if obj.version != data["expected_version"]:
        raise VersionConflict()


def changed(application, actor, event):
    application.version += 1
    application.save()
    append_state(
        application.owner,
        current(application.owner).snapshot,
        actor,
        "state.application_changed",
    )
    audit(application.owner, actor, event, application, application.assessment)
    return record(application)


def create_application(actor, data, obj=None):
    from .planning.assessment import ensure_current_quote
    loan = owned(LoanSimulation, actor, data["quote_id"])
    ensure_current_quote(actor, loan.id)
    require(
        loan.engine_version == "b-monthly-amortization-v1",
        "Create a new B quote; legacy simulations are read-only.",
    )
    require(
        not SimulatedApplication.objects.filter(loan=loan).exists(),
        "QUOTE_ALREADY_USED",
    )
    ensure_future(loan)
    application = SimulatedApplication.objects.create(owner=actor, loan=loan)
    append_state(actor, current(actor).snapshot, actor, "state.application_created")
    audit(actor, actor, "application.DRAFT_CREATED", application)
    return record(application)


def decide(application):
    require(
        application.loan.engine_version == "b-monthly-amortization-v1",
        "Create a new B quote; legacy simulations are read-only.",
    )
    ensure_future(application.loan)
    application.assessment = assess(application)
    application.status = {
        "AFFORDABLE": "APPROVED",
        "UNAFFORDABLE": "REJECTED",
        "INSUFFICIENT_DATA": "UNDER_REVIEW",
    }[application.assessment["status"]]


def application_action(actor, data, obj):
    check_version(obj, data)
    if data["action"] == "submit":
        require(obj.status == "DRAFT", "INVALID_STATE")
        audit(obj.owner, actor, "application.SUBMITTED", obj)
        decide(obj)
    else:
        require(obj.status not in {"DISBURSED", "CANCELLED"}, "INVALID_STATE")
        obj.status = "CANCELLED"
    return changed(obj, actor, "application." + obj.status)


def application_decision(actor, data, obj):
    check_version(obj, data)
    require(obj.status == "UNDER_REVIEW", "INVALID_STATE")
    obj.decision_reason = data["reason"]
    decide(obj)
    return changed(obj, actor, "application." + obj.status)


def disburse(actor, data, obj):
    from .planning.assessment import planning_loan
    require(not planning_loan(obj.loan_id), "PLANNING_LOAN_PAID_TO_SCHOOL")
    check_version(obj, data)
    require(obj.status == "APPROVED", "INVALID_STATE")
    require(
        obj.loan.engine_version == "b-monthly-amortization-v1",
        "Create a new B quote; legacy simulations are read-only.",
    )
    ensure_future(obj.loan)
    obj.assessment = assess(obj)
    if obj.assessment["status"] != "AFFORDABLE":
        obj.status = "UNDER_REVIEW"
        return {
            "application": changed(
                obj, actor, "application.DISBURSEMENT_REQUIRES_REVIEW"
            ),
            "account": None,
            "simulated": True,
        }
    from .lending_ledger import settle_loan

    disbursement = Disbursement.objects.create(
        owner=obj.owner,
        application=obj,
        amount=Decimal(obj.loan.result["net_proceeds"]),
        scheduled_on=business_date(obj.owner),
        status="settled",
    )
    account, wallet = settle_loan(disbursement, actor)
    obj.status = "DISBURSED"
    application = changed(obj, actor, "application.DISBURSED")
    return {
        "application": application,
        "account": account,
        "wallet": wallet,
        "simulated": True,
    }
