"""Read existing obligations; never copy loan contracts into editable reminder tasks."""
from decimal import Decimal

from finance.execution_services import available
from finance.lending_models import LoanAccount
from finance.workflow_models import DemoWallet, WalletBalance

from . import checklist
from .models import PlanBill, StudyTask


def task_rows(user, plan):
    rows = []
    for t in StudyTask.objects.filter(owner=user, plan=plan).order_by("due_date", "created_at"):
        template = checklist.title(plan.school_key, t.template_key) if t.template_key else None
        rows.append({"source_key": f"task:{t.id}", "kind": "task", "title": template or t.title,
             "due_date": t.due_date, "amount": str(t.amount) if t.amount is not None else None,
             "currency": t.currency, "done": t.done, "estimated": False, "source_text": t.source_text,
             "source_version": t.version, "target": "life", "template": bool(t.template_key)})
    return rows


def bill_rows(user, plan):
    # Loan repayments come only from actual loan accounts, never the old plan estimate.
    return [{"source_key": f"bill:{b.id}", "kind": "bill", "title": b.label,
             "due_date": b.due_date, "amount": str(b.amount), "currency": b.currency,
             "done": b.status == "PAID", "estimated": True, "source_version": b.status,
             "target": "bills", "paid_by_loan": _loan_part(b)}
            for b in PlanBill.objects.filter(owner=user, plan=plan).exclude(kind="loan").select_related("payout")]


def _loan_part(bill):
    """THB the signed loan pays (or will pay) the school for this bill, or None."""
    try:
        return str(bill.payout.amount)
    except PlanBill.payout.RelatedObjectDoesNotExist:
        return None


def loan_rows(user):
    wallet = DemoWallet.objects.filter(owner=user).first()
    balance = available(wallet) if wallet else None
    rows = []
    for account in LoanAccount.objects.filter(owner=user, status="ACTIVE").select_related("disbursement"):
        due = account.installments.filter(paid_on__isnull=True).order_by("number").first()
        if due is None:
            continue
        rows.append({"source_key": f"loan:{account.id}:{due.number}", "kind": "loan",
            "title": {"en": f"Loan installment {due.number}", "zh": f"贷款第 {due.number} 期还款"},
            "due_date": due.due_on, "amount": str(due.amount), "currency": "THB", "done": False,
            "estimated": False, "source_version": account.version, "target": "loans",
            "wallet_gap": str(max(Decimal(0), due.amount - balance)) if balance is not None else None,
            "account_id": str(account.id)})
    return rows


def source_rows(user, plan):
    rows = task_rows(user, plan) + bill_rows(user, plan) if plan else []
    if plan and plan.status == "CONFIRMED":
        rows.append({"source_key": f"enrollment:{plan.id}", "kind": "enrollment",
            "title": {"en": "Confirm arrival and enrollment", "zh": "核对报到与入学进度"},
            "due_date": plan.start_date, "amount": None, "currency": "", "done": False,
            "estimated": True, "source_version": plan.version, "target": "enrollment"})
    from .credit import rows as credit_rows
    return rows + loan_rows(user) + (credit_rows(user) if plan else [])


def balances(user):
    """Spendable demo money per currency, or None before the wallet exists."""
    wallet = DemoWallet.objects.filter(owner=user).first()
    if wallet is None:
        return None
    held = {"THB": available(wallet)}  # the ledger's home currency, as for loan installments above
    for row in WalletBalance.objects.filter(wallet=wallet):
        held[row.currency] = held.get(row.currency, Decimal(0)) + row.balance
    return held
