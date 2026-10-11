from pydantic import ValidationError as ContractError
from rest_framework import serializers

from finance.serializers import MoneyField, StrictInputMixin

from .contracts import Allocation, Draft, FundingAction


class Input(StrictInputMixin, serializers.Serializer):
    pass


class Versions(Input):
    analysis_version = serializers.IntegerField(min_value=0, required=False)
    state_version = serializers.IntegerField(min_value=1)
    budget_version = serializers.IntegerField(min_value=1)
    semester_id = serializers.UUIDField()


class SemesterInput(Input):
    template_key = serializers.CharField(max_length=100, required=False)
    template_version = serializers.IntegerField(min_value=1, required=False)
    room = serializers.ChoiceField(choices=["shared", "single"], default="shared")
    opening_balance = MoneyField(required=False)
    as_of = serializers.DateField(required=False)
    reserve = MoneyField(allow_null=True)


class RevisionInput(Versions):
    draft = serializers.JSONField()

    def validate_draft(self, value):
        return contract(Draft, value)


class ForecastInput(Versions):
    horizon = serializers.ChoiceField(choices=[30, 60, 90], default=90)
    conditional = serializers.BooleanField(default=False)


class FundingInput(Versions):
    allocations = serializers.ListField(
        child=serializers.JSONField(), max_length=50, default=list
    )
    actions = serializers.ListField(
        child=serializers.JSONField(), max_length=20, default=list
    )

    def validate_allocations(self, value):
        return [contract(Allocation, row) for row in value]

    def validate_actions(self, value):
        return [contract(FundingAction, row) for row in value]


class OcrConsentInput(Versions):
    ocr_consent = serializers.BooleanField(default=False)
    ocr_notice_version = serializers.CharField(max_length=50, required=False)
    language = serializers.ChoiceField(choices=["en", "zh", "zh-en"], default="zh-en")

    def validate(self, attrs):
        from .ocr import NOTICE_VERSION

        if attrs["ocr_consent"] and attrs.get("ocr_notice_version") != NOTICE_VERSION:
            raise serializers.ValidationError(
                {"ocr_notice_version": "Current notice required."}
            )
        return attrs


class UploadInput(OcrConsentInput):
    kind = serializers.ChoiceField(choices=["text", "pdf", "image"])
    file = serializers.FileField(max_length=150)


class TranscriptionInput(Versions):
    text = serializers.CharField(max_length=100000)


class TemplateUpgradeInput(Versions):
    template_key = serializers.CharField(max_length=100)
    template_version = serializers.IntegerField(min_value=1)
    confirm = serializers.BooleanField(default=False)


class BeneficiaryUpdateInput(Input):
    state_version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=150)
    destination_label = serializers.CharField(max_length=150)


class ConfirmationInput(Versions):
    draft = serializers.JSONField()
    issuer = serializers.CharField(max_length=200)
    selected_cost_ids = serializers.ListField(
        child=serializers.CharField(max_length=100), allow_empty=False
    )
    conflict_resolutions = serializers.DictField(
        child=serializers.CharField(max_length=2000), default=dict
    )

    def validate_draft(self, value):
        return contract(Draft, value)


def contract(model, value):
    try:
        return model.model_validate(value).model_dump(mode="json")
    except (ContractError, ValueError) as exc:
        raise serializers.ValidationError(str(exc)) from exc
