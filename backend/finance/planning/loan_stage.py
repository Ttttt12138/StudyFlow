"""Stage two of a planning loan (simulated): documents, signing, and payouts to the school bill by bill.

As with a study loan from a lender: once the application is approved, the borrower hands in the documents, signs,
and the loan is paid to the school on each bill's due date rather than into the student's wallet. Tuition is
covered first, then the other plan bills, in date order; a bill the loan only partly covers is split into the part
the loan pays and the part the family still pays. Repayments follow the signed schedule in the loan account.
"""
from copy import deepcopy
from datetime import timedelta
from decimal import ROUND_FLOOR, Decimal
from types import SimpleNamespace

from django.utils import timezone

from finance import money
from finance.lending_applications import changed, check_version, ensure_future
from finance.lending_ledger import create_account, loan_events
from finance.workflow_common import append_state, audit, current, owned, record, require
from finance.workflow_models import Disbursement, SimulatedApplication

from . import services
from .models import LoanPayout, PlanBill, StudyTask

PREFIX = "loan_doc:"
# The simulated admission notice is attached automatically when the application is submitted; nobody uploads it.
ADMISSION = PREFIX + "admission"
# (key, English, Chinese); the income proof names whoever signs.
DOCUMENTS = [
    ("admission", "Simulated admission notice (attached automatically)", "模拟录取通知（已自动附加）"),
    ("identity", "Provide a passport or ID", "提供护照或身份证件"),
]
INCOME = {
    "student_with_parent": ("Income proof of the co-borrower (parent)", "共同借款人（家长）收入证明"),
    "parent": ("Income proof of the borrower (parent)", "借款人（家长）收入证明"),
}
FIRST = ["tuition"]


def document_title(key):
    """Bilingual title of a loan document item (template_key "loan_doc:<name>[:<borrower>]"), else None."""
    if not key.startswith(PREFIX):
        return None
    name, _, borrower = key[len(PREFIX):].partition(":")
    if name == "income":
        en, zh = INCOME.get(borrower, INCOME["student_with_parent"])
        return {"en": en, "zh": zh}
    return next(({"en": en, "zh": zh} for k, en, zh in DOCUMENTS if k == name), None)


def seed_documents(user, plan, borrower):
    """The documents a loan application needs before signing, as to-dos: the admission notice arrives done."""
    have = set(StudyTask.objects.filter(plan=plan, template_key__startswith=PREFIX).values_list("template_key", flat=True))
    due = max(services.today_for(user) + timedelta(days=7), plan.start_date - timedelta(days=30))
    keys = [PREFIX + k for k, _, _ in DOCUMENTS] + [f"{PREFIX}income:{borrower}"]
    StudyTask.objects.bulk_create([StudyTask(owner=user, plan=plan, title=document_title(k)["en"], template_key=k,
                                             due_date=due, done=k == ADMISSION) for k in keys if k not in have])


def missing_documents(plan):
    return StudyTask.objects.filter(plan=plan, template_key__startswith=PREFIX, done=False)


def signed(plan):
    return LoanPayout.objects.filter(plan=plan).exists()


def _thb(amount, currency):
    if currency == "THB":
        return Decimal(amount)
    value = services.convert(amount, currency, "THB")
    require(value is not None, "FX_RATE_UNAVAILABLE")
    return Decimal(value["amount"])


def allocations(plan, total):
    """Project school payments without writing; signing uses these same amounts and order."""
    bills = list(PlanBill.objects.filter(plan=plan, status="DUE").exclude(kind="loan").filter(payout__isnull=True))
    bills.sort(key=lambda b: (b.kind not in FIRST, b.due_date, b.source_id))
    left = total
    for bill in bills:
        if left <= 0:
            break
        covered_thb, covered = _bill_portion(bill, left)
        if covered <= 0:
            break
        yield bill, covered_thb, covered
        left -= covered_thb


def _bill_portion(bill, left):
    cost = _thb(bill.amount, bill.currency)
    if cost <= left:
        return cost, bill.amount
    back = services.convert(left, "THB", bill.currency) if bill.currency != "THB" else {"amount": str(left)}
    require(back is not None, "FX_RATE_UNAVAILABLE")
    return left, Decimal(back["amount"]).quantize(Decimal("0.01"), ROUND_FLOOR)


def pending_bills(plan):
    """Bills provisionally funded by this plan's submitted loan, before it is signed."""
    from .assessment import plan_loans

    if plan.status != "CONFIRMED":
        return {}
    application = SimulatedApplication.objects.filter(owner_id=plan.owner_id, loan_id__in=plan_loans(plan),
        status__in=["APPROVED", "UNDER_REVIEW"]).select_related("loan").order_by("-created_at").first()
    if application is None:
        return {}
    total = Decimal(application.loan.result.get("net_proceeds") or "0")
    return {bill.pk: {"amount": money.fmt(covered, bill.currency), "status": application.status}
            for bill, _thb_amount, covered in allocations(plan, total)}


def _allocate(user, plan, application, total):
    """Commit the projected payments; split a partly funded bill into loan and self-funded parts."""
    left = total
    for bill, covered_thb, covered in allocations(plan, total):
        if covered < bill.amount:
            bill.amount -= covered
            bill.save(update_fields=["amount"])
            bill = PlanBill.objects.create(owner=user, plan=plan, kind=bill.kind, source_id=f"{bill.source_id}:loan"[:60],
                                           label=bill.label, due_date=bill.due_date, amount=covered, currency=bill.currency)
        LoanPayout.objects.create(owner=user, plan=plan, application=application, bill=bill, amount=covered_thb,
                                  bill_amount=covered, due_date=bill.due_date)
        left -= covered_thb
    return left


def settle_payouts(user, today=None):
    """Pays the school every scheduled tranche whose bill has fallen due by the demo date.

    A tranche waits, still scheduled, while the school's account is not verified."""
    from .payees import school_payee

    today = today or services.today_for(user)
    paid, verified = 0, {}
    for payout in LoanPayout.objects.filter(owner=user, status="SCHEDULED", due_date__lte=today).select_related(
            "bill", "plan__school_payee"):
        if payout.plan_id not in verified:
            verified[payout.plan_id] = school_payee(payout.plan).verified
        if not verified[payout.plan_id]:
            continue
        payout.status, payout.paid_on = "PAID", today
        payout.save(update_fields=["status", "paid_on"])
        if payout.bill.status == "DUE":
            payout.bill.status, payout.bill.paid_at, payout.bill.paid_on = "PAID", timezone.now(), today
            payout.bill.save(update_fields=["status", "paid_at", "paid_on"])
        paid += 1
    return paid


def sign(user, data, obj=None):
    from .assessment import plan_loans, read
    from .payees import require_verified

    plan = services.plan_for(user)
    require(plan is not None and plan.status == "CONFIRMED", "LOAN_SIGN_NEEDS_CONFIRMED_PLAN")
    require_verified(plan)
    application = owned(SimulatedApplication, user, data["application_id"])
    require(str(application.loan_id) in plan_loans(plan), "LOAN_NOT_IN_PLAN")
    check_version(application, data)
    require(application.status == "APPROVED", "LOAN_NOT_APPROVED")
    require(not missing_documents(plan).exists(), "LOAN_DOCUMENTS_MISSING")
    ensure_future(application.loan)
    today = services.today_for(user)
    loan = application.loan
    # Signed and paid to the school: nothing reaches the wallet, so only the repayments enter the cash plan.
    disbursement = Disbursement.objects.create(owner=user, application=application, amount=Decimal(loan.result["net_proceeds"]),
                                               scheduled_on=today, status="school")
    create_account(disbursement)
    snapshot = deepcopy(current(user).snapshot)
    snapshot["events"].extend(e for e in loan_events(disbursement, SimpleNamespace(effective_on=today, sequence=None))
                              if e["kind"] == "expense")
    append_state(user, snapshot, user, "state.loan_signed")
    application.status = "DISBURSED"
    changed(application, user, "application.SIGNED")
    unused = _allocate(user, plan, application, Decimal(loan.result["net_proceeds"]))
    settle_payouts(user, today)
    audit(user, user, "planning.loan_signed", application, {"unallocated": str(unused)})
    return read(user)


def tick_document(user, data, obj=None):
    """Marks a loan document as handed in (or not); the automatic admission notice cannot be changed."""
    from finance.services import VersionConflict

    from .assessment import read

    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    task = owned(StudyTask, user, data["task_id"])
    require(task.plan_id == plan.id and task.template_key.startswith(PREFIX), "LOAN_DOCUMENT_UNKNOWN")
    require(task.template_key != ADMISSION, "LOAN_DOCUMENT_AUTOMATIC")
    if task.version != data["expected_version"]:
        raise VersionConflict()
    task.done, task.version = data["done"], task.version + 1
    task.save(update_fields=["done", "version"])
    return read(user)


def payout_records(plan):
    return [{**record(p), "bill_label": p.bill.label, "bill_currency": p.bill.currency, "kind": p.bill.kind}
            for p in LoanPayout.objects.filter(plan=plan).select_related("bill")]
