"""Stage two: fixed bills from the confirmed plan, day-to-day spending and the monthly budget."""

import calendar
import math
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.utils import timezone

from finance import money
from finance.workflow_common import audit, require

from . import services
from .models import ExpenseEntry, PlanBill, StudyMonthBudget

BILLED = {"tuition", "housing", "insurance", "visa"}
CATEGORY_WORDS = {
    "food": ("饭", "餐", "吃", "咖啡", "奶茶", "早饭", "午饭", "晚饭", "外卖", "食", "lunch", "dinner", "breakfast",
             "coffee", "food", "meal", "snack"),
    "transport": ("打车", "地铁", "公交", "车费", "grab", "taxi", "bus", "train", "metro", "uber", "bts", "mrt"),
    "housing": ("房租", "水电", "宿舍", "rent", "electric", "water bill", "dorm"),
    "study": ("书", "文具", "打印", "课本", "book", "print", "stationery", "course"),
    "shopping": ("超市", "衣服", "购物", "日用", "shopping", "clothes", "supermarket", "groceries"),
    "fun": ("电影", "门票", "玩", "旅游", "酒吧", "movie", "ticket", "trip", "bar", "concert"),
    "health": ("药", "医院", "看病", "诊所", "pharmacy", "doctor", "clinic", "medicine"),
}


def guess_category(text):
    text = (text or "").lower()
    for category, words in CATEGORY_WORDS.items():
        if any(w in text for w in words):
            return category
    return "other"


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
    plan = services.plan_for(user)
    if plan is None:
        return []
    rows = PlanBill.objects.filter(owner=user, plan=plan)
    if upcoming_only:
        rows = rows.filter(status="DUE")
    rows = rows.order_by("due_date", "kind", "source_id")
    return [bill_record(b) for b in (rows[:limit] if limit else rows)]


def pay_bill(user, data, bill):
    """Records a bill as paid. Money moves through payments or remittances, not here."""
    require(bill.status == "DUE", "BILL_ALREADY_PAID")
    bill.status, bill.paid_at = "PAID", timezone.now()
    bill.save(update_fields=["status", "paid_at"])
    audit(user, user, "planning.bill_paid", bill, {"amount": str(bill.amount), "currency": bill.currency})
    return bill_record(bill)


def _enrolled_plan(user):
    plan = services.plan_for(user)
    require(plan is not None and plan.status == "ENROLLED", "ENROLLMENT_REQUIRED")
    return plan


def monthly_budget(plan):
    lines = (plan.snapshot or {}).get("lines") or []
    return sum((Decimal(l["amount"]) for l in lines if l["period"] == "month" and l.get("amount") is not None), Decimal(0))


def record_expense(user, data, via_agent=False):
    plan = _enrolled_plan(user)
    currency = (data.get("currency") or plan.snapshot.get("currency")).upper()
    money.require_supported(currency)
    amount = money.require_precision(Decimal(data["amount"]), currency)
    require(amount > 0, "Amount must be positive.")
    entry = ExpenseEntry.objects.create(
        owner=user, spent_on=data.get("spent_on") or services.today_for(user), amount=amount, currency=currency,
        category=data.get("category") or guess_category(data.get("note")), note=(data.get("note") or "")[:200],
        via_agent=via_agent)
    audit(user, user, "planning.expense_recorded", entry, {"amount": str(amount), "currency": currency})
    return {"expense": expense_record(entry), **spending(user, entry.spent_on.strftime("%Y-%m"))}


def expense_record(entry):
    return {"id": str(entry.id), "spent_on": entry.spent_on.isoformat(), "category": entry.category,
            "amount": money.fmt(entry.amount, entry.currency), "currency": entry.currency, "note": entry.note,
            "via_agent": entry.via_agent}


def spending(user, month=None, detail=True):
    """Spending for one month in the plan currency against the monthly living budget."""
    plan = _enrolled_plan(user)
    currency = plan.snapshot.get("currency")
    month = month or services.today_for(user).strftime("%Y-%m")
    require(len(month) == 7 and month[4] == "-" and month[:4].isdigit() and month[5:].isdigit()
            and 1 <= int(month[5:]) <= 12, "MONTH_INVALID")
    year, number = int(month[:4]), int(month[5:])
    rows = ExpenseEntry.objects.filter(owner=user, spent_on__year=year, spent_on__month=number, voided_at__isnull=True)
    totals, unconverted = defaultdict(Decimal), []
    for entry in rows:
        value = entry.amount
        if entry.currency != currency:
            converted = services.convert(entry.amount, entry.currency, currency)
            if converted is None:
                unconverted.append(str(entry.id))
                continue
            value = Decimal(converted["amount"])
        totals[entry.category] += value
    spent = sum(totals.values(), Decimal(0))
    override = StudyMonthBudget.objects.filter(plan=plan, month=month).first()
    budget = override.amount if override else monthly_budget(plan)
    monthly = [line for line in plan.snapshot.get("lines", []) if line["period"] == "month"]
    known = bool(override or (monthly and all(line.get("amount") is not None for line in monthly)))
    result = {"month": month, "currency": currency, "spent": money.fmt(spent, currency),
              "budget_known": known, "budget_source": "declared" if override else "estimate",
              "budget_version": override.version if override else 0,
              "budget": money.fmt(budget, currency), "remaining": money.fmt(budget - spent, currency),
              "over_budget": known and not unconverted and spent > budget,
              "by_category": {k: money.fmt(v, currency) for k, v in sorted(totals.items())},
              "unconverted": unconverted, "is_simulated": True}
    if detail:
        result["recent"] = [expense_record(e) for e in rows.order_by("-spent_on", "-created_at")[:10]]
    return result


def spending_page(user, month=None, offset=0):
    result = spending(user, month)
    year, number = map(int, result["month"].split("-"))
    rows = ExpenseEntry.objects.filter(owner=user, spent_on__year=year, spent_on__month=number, voided_at__isnull=True)
    count = rows.count()
    entries = rows.order_by("-spent_on", "-created_at", "-id")[offset:offset + 50]
    return {**result, "entries": [expense_record(e) for e in entries], "count": count,
            "next_offset": offset + 50 if offset + 50 < count else None}


def summary(user, detail=True):
    """Everything the in-school dashboard shows."""
    plan = services.plan_for(user)
    if plan is None or plan.status != "ENROLLED":
        return {"enrolled": False}
    upcoming = bills(user, upcoming_only=True)
    today = services.today_for(user)
    return {"enrolled": True, "today": today.isoformat(),
            "plan": services.plan_record(plan, services.home_currency(user))["plan"],
            "upcoming_bills": upcoming[:8], "overdue": [b for b in upcoming if b["due_date"] < today.isoformat()],
            "bill_count": len(upcoming), "spending": spending(user, detail=detail)}


def pay_from_wallet(user, data, bill):
    """Pays one plan bill from the demo wallet in the bill's currency, then records it as paid.

    A bill the signed loan pays to the school is not paid again. Home-currency payments also settle a confirmed
    expense in the financial state, as other wallet payments do."""
    from copy import deepcopy

    from finance import money
    from finance.execution_services import available
    from finance.wallets import balance_of, post, wallet
    from finance.workflow_common import append_state, current

    from .models import LoanPayout

    require(bill.status == "DUE", "BILL_ALREADY_PAID")
    require(not LoanPayout.objects.filter(bill=bill).exists(), "BILL_PAID_BY_LOAN")
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
    pay_bill(user, {}, bill)
    bill.refresh_from_db()
    return {"bill": bill_record(bill), "balance": money.fmt(balance_of(item, bill.currency), bill.currency),
            "currency": bill.currency, "is_simulated": True}


def wallet_bills(user):
    """The plan's bills for the wallet's pay tab: unpaid first, each with who pays it."""
    from .models import LoanPayout

    plan = services.plan_for(user)
    if plan is None:
        return {"bills": [], "is_simulated": True}
    loan = set(LoanPayout.objects.filter(plan=plan).values_list("bill_id", flat=True))
    rows = [{**bill_record(b), "paid_by_loan": b.id in loan}
            for b in PlanBill.objects.filter(owner=user, plan=plan).exclude(kind="loan").order_by("status", "due_date")]
    return {"bills": rows, "is_simulated": True}
