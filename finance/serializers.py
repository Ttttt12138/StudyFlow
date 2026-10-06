from decimal import Decimal
from collections.abc import Mapping
from urllib.parse import urlsplit
from django.conf import settings
from rest_framework import serializers
from .models import SourceDocument

class StrictInputMixin:
    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            allowed = {name for name, field in self.fields.items() if not field.read_only}
            unknown = set(data) - allowed
            if unknown:
                raise serializers.ValidationError({
                    str(key): ["Unknown or read-only field."] for key in sorted(unknown)
                })
        return super().to_internal_value(data)

class MoneyField(serializers.DecimalField):
    def __init__(self, **kwargs):
        super().__init__(max_digits=16, decimal_places=2, min_value=Decimal("0"), **kwargs)

    def to_internal_value(self, data):
        if isinstance(data, (float, bool)):
            raise serializers.ValidationError("Use an exact decimal string for money.")
        return super().to_internal_value(data)

class CurrencyAmountField(MoneyField):
    """Any number of decimals, so services report AMOUNT_PRECISION_INVALID per currency."""
    def __init__(self, **kwargs):
        serializers.DecimalField.__init__(
            self, max_digits=None, decimal_places=None, min_value=Decimal("0"), **kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if abs(value) >= Decimal("1e14"):
            raise serializers.ValidationError("Amount exceeds supported monetary precision.")
        return value

class EventSerializer(StrictInputMixin, serializers.Serializer):
    id = serializers.CharField(max_length=100)
    label = serializers.CharField(max_length=200)
    kind = serializers.ChoiceField(choices=["expense", "income"])
    amount = MoneyField(allow_null=True)
    date = serializers.DateField(allow_null=True)
    certainty = serializers.ChoiceField(choices=["confirmed", "estimated", "missing"])
    source_id = serializers.UUIDField(required=False, allow_null=True)
    beneficiary_id = serializers.UUIDField(required=False,allow_null=True)
    settled_sequence = serializers.IntegerField(min_value=1,required=False)
    evidence_note = serializers.CharField(max_length=2000, required=False, allow_blank=True)

    def validate(self, data):
        if data["certainty"] == "confirmed" and (data["amount"] is None or data["date"] is None):
            raise serializers.ValidationError("Confirmed events require amount and date.")
        return data

class SnapshotSerializer(StrictInputMixin, serializers.Serializer):
    currency = serializers.ChoiceField(choices=[settings.STUDYFLOW_HOME_CURRENCY])
    as_of = serializers.DateField()
    opening_balance = MoneyField()
    reserve = MoneyField()
    events = EventSerializer(many=True, max_length=1000)

    def validate(self, data):
        ids = [event["id"] for event in data["events"]]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({"events": "Event IDs must be unique."})
        source_ids = {e.get("source_id") for e in data["events"] if e.get("source_id")}
        owned_ids = set(SourceDocument.objects.filter(
            id__in=source_ids, owner=self.context["request"].user
        ).values_list("id", flat=True)) if source_ids else set()
        if source_ids != owned_ids:
            raise serializers.ValidationError({"events": "Source is unavailable to this user."})
        from .workflow_models import Beneficiary
        beneficiary_ids = {e.get("beneficiary_id") for e in data["events"] if e.get("beneficiary_id")}
        owned_beneficiaries = set(Beneficiary.objects.filter(
            id__in=beneficiary_ids,owner=self.context["request"].user
        ).values_list("id",flat=True)) if beneficiary_ids else set()
        if beneficiary_ids != owned_beneficiaries:
            raise serializers.ValidationError({"events":"Beneficiary is unavailable to this user."})
        for event in data["events"]:
            if event["date"] and event["date"] < data["as_of"]:
                raise serializers.ValidationError({"events": "Events before the opening snapshot must be excluded."})
        return data

class StateWriteSerializer(StrictInputMixin, serializers.Serializer):
    expected_version = serializers.IntegerField(min_value=0)
    snapshot = SnapshotSerializer()

class StateResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    version = serializers.IntegerField()
    snapshot = SnapshotSerializer()

class ForecastRequestSerializer(StrictInputMixin, serializers.Serializer):
    state_version = serializers.IntegerField(min_value=1)
    end_date = serializers.DateField()
    include_estimates = serializers.BooleanField(default=False)

class ForecastResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    state_version = serializers.IntegerField()
    engine_version = serializers.CharField()
    result = serializers.JSONField()

class SourceSerializer(StrictInputMixin, serializers.ModelSerializer):
    class Meta:
        model = SourceDocument
        fields = ["id", "title", "kind", "url", "note", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, data):
        if data.get("url") and urlsplit(data["url"]).scheme not in {"https", "http"}:
            raise serializers.ValidationError({"url": "Only HTTP(S) website URLs are supported."})
        if data.get("kind") == "official_url" and not data.get("url"):
            raise serializers.ValidationError({"url": "A URL is required."})
        return data

class HealthSerializer(serializers.Serializer):
    status = serializers.CharField()
    database = serializers.CharField()
