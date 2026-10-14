from django.shortcuts import get_object_or_404
from django.utils import timezone

from finance import money
from finance.services import VersionConflict
from finance.workflow_common import audit, require

from . import in_school, life, services
from .models import ExpenseEntry, PlanBill, PlanningProfile, ReminderPreference, StudyMonthBudget, StudyTask


def create_task(user, data, obj=None):
    plan = services.plan_for(user)
    require(plan is not None, "PLAN_REQUIRED")
    money.require_supported(data["currency"])
    if data.get("amount") is not None:
        money.require_precision(data["amount"], data["currency"])
    task = StudyTask.objects.create(owner=user, plan=plan, **data)
    audit(user, user, "planning.task_created", task)
    return {"task_id": str(task.id), "title": task.title, "due_date": str(task.due_date) if task.due_date else None}


def _complete(user, item, done):
    kind, pk = item["source_key"].split(":", 1)
    require(kind in ("task", "bill", "credit"), "USE_ORIGINAL_ENROLLMENT_OR_REPAYMENT_ACTION")
    if kind == "credit":
        require(done, "CREDIT_REOPEN_NOT_SUPPORTED")
        from .credit import repay
        repay(user, pk)
    elif kind == "task":
        task = get_object_or_404(StudyTask, owner=user, pk=pk)
        task.done, task.version = done, task.version + 1
        task.save(update_fields=["done", "version"])
        audit(user, user, "planning.task_updated", task, {"done": done})
    else:
        require(done, "BILL_REOPEN_NOT_SUPPORTED")
        bill = get_object_or_404(PlanBill, owner=user, pk=pk)
        in_school.pay_bill(user, {}, bill)


def act(user, data, obj=None):
    item = next((r for r in life.read(user)["items"] if r["source_key"] == data["source_key"]), None)
    require(item is not None, "REMINDER_NOT_FOUND")
    if item["token"] != data["expected_token"]:
        raise VersionConflict()
    action, day = data["action"], data.get("date")
    require(action not in ("snooze", "reschedule") or day is not None, "REMINDER_DATE_REQUIRED")
    require(action != "snooze" or day > services.today_for(user), "SNOOZE_MUST_BE_FUTURE")
    require(action != "reschedule" or item["kind"] not in ("loan", "credit"), "LOAN_DUE_DATE_IS_CONTRACTUAL")
    require(action != "set_amount" or item["kind"] in ("task", "bill"), "LOAN_AMOUNT_IS_CONTRACTUAL")
    require(action != "set_amount" or "amount" in data, "REMINDER_AMOUNT_REQUIRED")
    # The loan pays this bill to the school on its date: nothing to pay, reschedule or re-price by hand.
    require(not item.get("paid_by_loan") or action in ("acknowledge", "snooze"), "BILL_PAID_BY_LOAN")
    pref, _ = ReminderPreference.objects.get_or_create(owner=user, source_key=data["source_key"])
    if action in ("complete", "reopen"):
        _complete(user, item, action == "complete")
    elif action == "set_amount":
        if data["amount"] is not None:
            money.require_precision(data["amount"], item["currency"])
        pref.amount_override = data["amount"]
    elif action == "acknowledge":
        pref.seen_token = item["notice_token"]
    elif action == "snooze":
        pref.snoozed_until = day
    else:
        pref.due_override, pref.snoozed_until = day, None
    pref.version += 1
    pref.save()
    audit(user, user, "planning.reminder_updated", pref, {"action": action})
    return life.read(user)


def save_budget(user, data, obj=None):
    plan = in_school._enrolled_plan(user)
    money.require_precision(data["amount"], plan.snapshot["currency"])
    row = StudyMonthBudget.objects.filter(plan=plan, month=data["month"]).first()
    if (row.version if row else 0) != data["expected_version"]:
        raise VersionConflict()
    if row:
        row.amount, row.version = data["amount"], row.version + 1
        row.save(update_fields=["amount", "version"])
    else:
        row = StudyMonthBudget.objects.create(owner=user, plan=plan, month=data["month"], amount=data["amount"])
    audit(user, user, "planning.month_budget_saved", row)
    return in_school.spending(user, data["month"])


def undo_expense(user, data, obj=None):
    row = get_object_or_404(ExpenseEntry, owner=user, pk=data["expense_id"])
    if row.voided_at is None:
        row.voided_at = timezone.now()
        row.save(update_fields=["voided_at"])
        audit(user, user, "planning.expense_voided", row)
    return in_school.spending(user, row.spent_on.strftime("%Y-%m"))


def advance_clock(user, data, obj=None):
    from finance import execution_services
    from finance.workflow_models import DemoWallet
    today = services.today_for(user)
    require(0 <= (data["date"] - today).days <= 730, "DEMO_DATE_MUST_ADVANCE_WITHIN_730_DAYS")
    if DemoWallet.objects.filter(owner=user).exists():
        execution_services.advance_clock(user, data)
    else:
        profile, _ = PlanningProfile.objects.get_or_create(owner=user)
        profile.demo_date = data["date"]
        profile.save(update_fields=["demo_date"])
        audit(user, user, "planning.demo_date_advanced", profile, {"date": str(data["date"])})
    from .loan_stage import settle_payouts
    settle_payouts(user, data["date"])
    return life.read(user)
