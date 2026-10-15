from django.shortcuts import get_object_or_404

from finance import money
from finance.services import VersionConflict
from finance.workflow_common import audit, require

from . import in_school, life, services
from .models import PlanBill, PlanningProfile, ReminderPreference, StudyTask


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
    # Loan installments are repaid from the loans tool, not ticked off.
    require(kind in ("task", "bill"), "USE_ORIGINAL_REPAYMENT_ACTION")
    if kind == "task":
        from .loan_stage import ADMISSION

        task = get_object_or_404(StudyTask, owner=user, pk=pk)
        require(task.template_key != ADMISSION, "LOAN_DOCUMENT_AUTOMATIC")
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
    require(action != "reschedule" or item["kind"] != "loan", "LOAN_DUE_DATE_IS_CONTRACTUAL")
    require(action != "set_amount" or item["kind"] in ("task", "bill"), "LOAN_AMOUNT_IS_CONTRACTUAL")
    require(action != "set_amount" or "amount" in data, "REMINDER_AMOUNT_REQUIRED")
    # The loan pays this bill to the school on its date: nothing to pay, reschedule or re-price by hand.
    require(not item.get("paid_by_loan") or action in ("acknowledge", "snooze"), "BILL_PAID_BY_LOAN")
    # Its share is already set aside by the loan awaiting approval or signing: the same holds until then.
    require(not item.get("loan_pending") or action in ("acknowledge", "snooze"), "BILL_AWAITING_LOAN")
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
