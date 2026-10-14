"""Simulated pay-later credit line for plan bills.

The limit is a fixed 2,000 CNY for every student, settled in THB at the reference rate (income is not asked).
Paying a bill with credit records the
bill as paid and opens a charge owed back within 30 days; repaying frees the line again. Like recording a bill as
paid, nothing moves in the demo wallet here.
"""
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal

from django.shortcuts import get_object_or_404

from finance.services import VersionConflict
from finance.workflow_common import audit, require

from . import assessment, services
from .models import CreditCharge, PlanBill

CURRENCY = "THB"
FIXED_LIMIT, FIXED_CURRENCY = Decimal("2000.00"), "CNY"
TERM_DAYS = 30


def fixed_limit():
    """The fixed limit in THB, or 0 while the reference rate is unavailable."""
    value = services.convert(FIXED_LIMIT, FIXED_CURRENCY, CURRENCY)
    return Decimal(value["amount"]).quantize(Decimal("0.01"), rounding=ROUND_DOWN) if value else Decimal(0)


def line(user, plan=None):
    limit = fixed_limit()
    open_charges = CreditCharge.objects.filter(owner=user, repaid_on__isnull=True)
    used = sum((c.amount for c in open_charges), Decimal(0))
    return {"currency": CURRENCY, "limit": f"{limit:.2f}", "used": f"{used:.2f}",
            "available": f"{max(Decimal(0), limit - used):.2f}",
            "fixed": {"amount": f"{FIXED_LIMIT:.2f}", "currency": FIXED_CURRENCY},
            "basis_known": limit > 0, "term_days": TERM_DAYS, "is_simulated": True,
            "charges": [record(c) for c in CreditCharge.objects.filter(owner=user).order_by("repaid_on", "due_date")[:20]]}


def record(charge):
    return {"id": str(charge.id), "bill_id": str(charge.bill_id), "label": charge.bill.label, "amount": f"{charge.amount:.2f}",
            "currency": charge.currency, "charged_on": charge.charged_on.isoformat(), "due_date": charge.due_date.isoformat(),
            "repaid_on": charge.repaid_on.isoformat() if charge.repaid_on else None}


def pay(user, data, obj=None):
    """Pays one open THB bill from the credit line; the to-do token guards against a stale view."""
    from . import life
    item = next((r for r in life.read(user)["items"] if r["source_key"] == data["source_key"]), None)
    require(item is not None, "REMINDER_NOT_FOUND")
    if item["token"] != data["expected_token"]:
        raise VersionConflict()
    require(item["kind"] == "bill" and not item["done"], "CREDIT_BILL_REQUIRED")
    require(not item.get("paid_by_loan"), "BILL_PAID_BY_LOAN")
    require(item["currency"] == CURRENCY, "CREDIT_THB_ONLY")
    bill = PlanBill.objects.select_for_update().get(owner=user, pk=item["source_key"].split(":", 1)[1])
    require(bill.status == "DUE", "BILL_ALREADY_PAID")
    if bill.kind == "tuition":
        from .payees import require_verified
        require_verified(bill.plan)
    amount = Decimal(item["amount"])
    require(amount <= Decimal(line(user)["available"]), "CREDIT_LIMIT_EXCEEDED")
    today = services.today_for(user)
    charge = CreditCharge.objects.create(owner=user, plan=bill.plan, bill=bill, amount=amount, currency=CURRENCY,
                                         charged_on=today, due_date=today + timedelta(days=TERM_DAYS))
    from .in_school import pay_bill
    pay_bill(user, {}, bill)
    audit(user, user, "planning.credit_charged", charge, {"amount": str(amount), "bill": str(bill.id)})
    return life.read(user)


def repay(user, charge_id):
    charge = get_object_or_404(CreditCharge.objects.select_for_update(), owner=user, pk=charge_id)
    require(charge.repaid_on is None, "CREDIT_ALREADY_REPAID")
    charge.repaid_on, charge.version = services.today_for(user), charge.version + 1
    charge.save(update_fields=["repaid_on", "version"])
    audit(user, user, "planning.credit_repaid", charge, {"amount": str(charge.amount)})


def rows(user):
    """Open and repaid charges as to-dos in "This month"."""
    return [{"source_key": f"credit:{c.id}", "kind": "credit",
             "title": {"en": f"Pay back credit · {c.bill.label.get('en', '')}", "zh": f"信用支付待还 · {c.bill.label.get('zh', '')}"},
             "due_date": c.due_date, "amount": f"{c.amount:.2f}", "currency": c.currency, "done": c.repaid_on is not None,
             "estimated": False, "source_version": c.version, "target": "life"}
            for c in CreditCharge.objects.filter(owner=user).select_related("bill")]
