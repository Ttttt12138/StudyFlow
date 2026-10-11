from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers as s
from studyflow_ai.bank_data import CATEGORIES

from finance.serializers import MoneyField
from finance.workflow_serializers import Input


@extend_schema_serializer(component_name="TransactionUploadInput")
class UploadInput(Input):
    file = s.FileField()
    source_type = s.ChoiceField(
        choices=["synthetic", "user_uploaded"], default="user_uploaded"
    )


class CoverageInput(Input):
    account_id = s.CharField(max_length=150)
    start = s.DateField()
    end = s.DateField()
    complete = s.BooleanField(default=False)

    def validate(self, data):
        if data["end"] < data["start"]:
            raise s.ValidationError("COVERAGE_DATE_ORDER")
        return data


class ConfirmInput(Input):
    selected_rows = s.ListField(
        child=s.CharField(max_length=40), min_length=1, max_length=10000
    )
    keep_similar_rows = s.ListField(child=s.CharField(max_length=40), default=list)
    coverage = CoverageInput(many=True, allow_empty=False, max_length=30)


@extend_schema_serializer(component_name="TransactionRevisionInput")
class RevisionInput(Input):
    category = s.ChoiceField(choices=CATEGORIES)
    cost_id = s.CharField(max_length=100, required=False, allow_blank=True)
    refund_of = s.UUIDField(required=False, allow_null=True)
    reason = s.CharField(max_length=500)


class RecurringInput(Input):
    decision = s.ChoiceField(choices=["accepted", "ignored"])
    cost_id = s.CharField(max_length=100, allow_blank=True, default="")


class BalanceInput(Input):
    state_version = s.IntegerField(min_value=1)
    amount = MoneyField()
    as_of = s.DateField()


class TransactionQueryInput(s.Serializer):
    category = s.ChoiceField(choices=CATEGORIES, required=False)
    account_id = s.UUIDField(required=False)
    cost_id = s.CharField(max_length=100, required=False)
