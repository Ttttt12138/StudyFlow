"""Fixed bills from the confirmed plan: listed, paid from the wallet, or paid by the signed loan."""

import calendar
import math
from datetime import date
from decimal import Decimal

from django.utils import timezone

from finance import money
from finance.workflow_common import audit, require

from . import services
from .models import LoanPayout, PlanBill

BILLED = {"tuition", "housing", "insurance", "visa"}


def add_months(day, months):
    month = day.month - 1 + months
    year, month = day.year + month // 12, month % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def generate_bills(user, plan):
    """Tuition, housing, insurance and visa bills for every year, plus loan installments."""
    lines = (plan.snapshot or {}).get("lines") or []
    currency = (plan.snapshot or {}).get("currency")
    semesters = _semesters(plan)
    created = 0
    for line in lines:
        if line["category"] not in BILLED or line["period"] == "month" or line.get("amount") is None:
            continue
        if "period_amounts" in line:
            created += _snapshot_bills(user, plan, line, currency, semesters)
            continue
        amount = Decimal(line["amount"])
        if amount <= 0:
            continue
        course_end = add_months(plan.start_date, round(plan.years * 12))
        for year in range(math.ceil(plan.years)):
            year_start = add_months(plan.start_date, 12 * year)
            if line["period"] == "once":
                dues = [(plan.start_date, "once")] if year == 0 else []
            elif line["period"] == "year":
                dues = [(year_start, f"y{year + 1}")]
            else:
                dues = [(add_months(year_start, k * 12 // semesters), f"y{year + 1}s{k + 1}")
                        for k in range(semesters)]
            for due, tag in dues:
                if due >= course_end:  # the last half year of a 3.5-year course has no second semester
                    continue
                _, made = PlanBill.objects.get_or_create(
                    plan=plan, source_id=f"{line['cost_id']}:{tag}"[:60],
                    defaults={"owner": user, "kind": line["category"], "label": line["label"], "due_date": due,
                              "amount": amount, "currency": currency})
                created += made
    if plan.loan_id:
        for row in plan.loan.result.get("repayments", []):
            _, made = PlanBill.objects.get_or_create(
                plan=plan, source_id=f"loan:{row['number']}",
                defaults={"owner": user, "kind": "loan", "due_date": date.fromisoformat(row["due_date"]),
                          "amount": Decimal(row["amount"]), "currency": "THB",
                          "label": {"en": f"Loan installment {row['number']}", "zh": f"贷款第 {row['number']} 期还款"}})
            created += made
    audit(user, user, "planning.bills_generated", plan, {"created": created})
    return created


def _snapshot_bills(user, plan, line, currency, semesters):
    """New snapshots freeze every billed amount; legacy snapshots keep their old schedule."""
    made_count = 0
    step = {"once": 0, "year": 12, "semester": 12 // semesters}[line["period"]]
    for index, amount in enumerate(line["period_amounts"]):
        if Decimal(amount) <= 0:
            continue
        tag = "once" if line["period"] == "once" else (
            f"y{index + 1}" if line["period"] == "year" else f"y{index // semesters + 1}s{index % semesters + 1}")
        _, made = PlanBill.objects.get_or_create(plan=plan, source_id=f"{line['cost_id']}:{tag}"[:60],
            defaults={"owner": user, "kind": line["category"], "label": line["label"],
                      "due_date": add_months(plan.start_date, index * step + line.get("start_month", 0)), "amount": amount, "currency": currency})
        made_count += made
    return made_count


def _semesters(plan):
    from . import catalog

    entry = catalog.school(plan.school_key)
    return entry.calendar.semesters_per_year if entry else 2


def bill_record(bill):
    return {"id": str(bill.id), "kind": bill.kind, "label": bill.label, "due_date": bill.due_date.isoformat(),
            "amount": money.fmt(bill.amount, bill.currency), "currency": bill.currency, "status": bill.status,
            "paid_at": bill.paid_at.isoformat() if bill.paid_at else None, "is_simulated": True}


def bills(user, upcoming_only=False, limit=None):
    """The plan's bills, each saying whether the signed loan pays it to the school."""
    plan = services.plan_for(user)
    if plan is None:
        return []
    rows = PlanBill.objects.filter(owner=user, plan=plan)
    if upcoming_only:
        rows = rows.filter(status="DUE")
    rows = rows.order_by("due_date", "kind", "source_id")
    loan = set(LoanPayout.objects.filter(plan=plan).values_list("bill_id", flat=True))
    return [{**bill_record(b), "paid_by_loan": b.id in loan} for b in (rows[:limit] if limit else rows)]


def pay_bill(user, data, bill):
    """Records a bill as paid. Money moves through payments or remittances, not here; the loan pays its own bills."""
    require(bill.status == "DUE", "BILL_ALREADY_PAID")
    require(not LoanPayout.objects.filter(bill=bill).exists(), "BILL_PAID_BY_LOAN")
    require_no_pending_loan(bill)
    bill.status, bill.paid_at, bill.paid_on = "PAID", timezone.now(), data.get("paid_on") or services.today_for(user)
    bill.save(update_fields=["status", "paid_at", "paid_on"])
    audit(user, user, "planning.bill_paid", bill, {"amount": str(bill.amount), "currency": bill.currency})
    return bill_record(bill)


def pay_from_wallet(user, data, bill):
    """Pays one plan bill from the demo wallet in the bill's currency, then records it as paid.

    A bill the signed loan pays to the school is not paid again, and tuition goes only to a verified school account.
    Home-currency payments also settle a confirmed expense in the financial state, as other wallet payments do."""
    from copy import deepcopy

    from finance import money
    from finance.execution_services import available
    from finance.wallets import balance_of, post, wallet
    from finance.workflow_common import append_state, current

    from .payees import require_verified

    require(bill.status == "DUE", "BILL_ALREADY_PAID")
    require(not LoanPayout.objects.filter(bill=bill).exists(), "BILL_PAID_BY_LOAN")
    require_no_pending_loan(bill)
    if bill.kind == "tuition":
        require_verified(bill.plan)
    item = wallet(user)
    home = bill.currency == money.home_currency()
    require((available(item) if home else balance_of(item, bill.currency)) >= bill.amount, "WALLET_BALANCE_TOO_LOW")
    entry = post(item, bill.currency, -bill.amount, {"plan_bill": bill})
    if home:
        snapshot = deepcopy(current(user).snapshot)
        label = bill.label.get("en") if isinstance(bill.label, dict) else str(bill.label)
        snapshot["events"].append({"id": f"bill:{bill.id}", "label": (label or "Plan bill")[:120], "kind": "expense",
                                   "amount": money.fmt(bill.amount, bill.currency), "date": item.clock.isoformat(),
                                   "certainty": "confirmed", "settled_sequence": entry.sequence})
        append_state(user, snapshot, user, "state.plan_bill_paid")
    pay_bill(user, {"paid_on": item.clock}, bill)
    bill.refresh_from_db()
    return {"bill": bill_record(bill), "balance": money.fmt(balance_of(item, bill.currency), bill.currency),
            "currency": bill.currency, "is_simulated": True}


def require_no_pending_loan(bill):
    from .loan_stage import pending_bills

    require(bill.pk not in pending_bills(bill.plan), "BILL_AWAITING_LOAN")


def wallet_bills(user):
    """The plan's bills for the wallet's pay tab: unpaid first, each with who pays it, and the school's account."""
    from .payees import payee_record
    from .loan_stage import pending_bills

    plan = services.plan_for(user)
    if plan is None:
        return {"bills": [], "school_payee": None, "is_simulated": True}
    loan = set(LoanPayout.objects.filter(plan=plan).values_list("bill_id", flat=True))
    pending = pending_bills(plan)
    rows = [{**bill_record(b), "paid_by_loan": b.id in loan, "loan_pending": pending.get(b.id)}
            for b in PlanBill.objects.filter(owner=user, plan=plan).exclude(kind="loan").order_by("status", "due_date")]
    return {"bills": rows, "school_payee": payee_record(plan), "is_simulated": True}
