from rest_framework import serializers as s

from finance.workflow_serializers import Input


class StudyTaskInput(Input):
    title = s.CharField(max_length=200)
    due_date = s.DateField(allow_null=True, default=None)
    amount = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, allow_null=True, default=None)
    currency = s.CharField(max_length=3, default="THB")
    source_text = s.CharField(max_length=4000, allow_blank=True, default="")


class ReminderActionInput(Input):
    source_key = s.CharField(max_length=100)
    expected_token = s.CharField(max_length=64)
    action = s.ChoiceField(choices=["acknowledge", "snooze", "reschedule", "complete", "reopen", "set_amount"])
    date = s.DateField(required=False)
    # set_amount: the amount on the school's notice; null goes back to the plan estimate.
    amount = s.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False, allow_null=True)


class CreditPayInput(Input):
    source_key = s.CharField(max_length=100)
    expected_token = s.CharField(max_length=64)


class StudyBudgetInput(Input):
    month = s.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$")
    amount = s.DecimalField(max_digits=16, decimal_places=2, min_value=0)
    expected_version = s.IntegerField(min_value=0)


class UndoExpenseInput(Input):
    expense_id = s.UUIDField()


class StudyClockInput(Input):
    date = s.DateField()
