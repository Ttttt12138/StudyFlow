from datetime import date

from rest_framework import serializers as s

from .serializers import MoneyField
from .workflow_serializers import Input


class MonthInput(Input):
    month = s.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$")
    income = MoneyField(allow_null=True, default=None)
    living_expenses = MoneyField(allow_null=True, default=None)
    existing_repayments = MoneyField(allow_null=True, default=None)

    def validate_month(self, value):
        try:
            date.fromisoformat(value + "-01")
        except ValueError:
            raise s.ValidationError("Invalid calendar month.") from None
        return value


class ProfileInput(Input):
    expected_version = s.IntegerField(min_value=0)
    months = MonthInput(many=True, max_length=120)

    def validate_months(self, values):
        if len({row["month"] for row in values}) != len(values):
            raise s.ValidationError("Duplicate profile month.")
        return values


class RepaymentInput(Input):
    expected_version = s.IntegerField(min_value=0)
    installment_number = s.IntegerField(min_value=1, max_value=384)


class ExplanationInput(Input):
    scenario_id = s.UUIDField()
