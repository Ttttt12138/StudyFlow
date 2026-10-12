from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import Field, model_validator
from rest_framework import serializers

from finance.lending_core.schemas import Amount, Input, QuoteInput
from finance.readiness.serializers import Input as ApiInput
from finance.readiness.serializers import Versions, contract


class CostChange(Input):
    cost_id: str = Field(min_length=1, max_length=100)
    amount: Amount = Field(le=Decimal("99999999999999.99"))
    effective_on: date


class SupportChange(Input):
    source_id: UUID | None = None
    amount: Amount = Field(gt=0)
    available_on: date


class Scenario(Input):
    name: str = Field(min_length=1, max_length=100)
    costs: list[CostChange] = Field(default_factory=list, max_length=20)
    family_support: list[SupportChange] = Field(default_factory=list, max_length=10)
    allow_new_loan: bool = True
    loan: QuoteInput | None = None
    loan_available_on: date | None = None

    @model_validator(mode="after")
    def consistency(self):
        if len({x.cost_id for x in self.costs}) != len(self.costs):
            raise ValueError("Duplicate cost override")
        ids = [x.source_id for x in self.family_support if x.source_id]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate funding override")
        if self.loan and (not self.allow_new_loan or not self.loan_available_on):
            raise ValueError("Loan requires allowance and receipt date")
        return self


class SimulateInput(Versions):
    analysis_version = serializers.IntegerField(min_value=0)
    scenarios = serializers.ListField(
        child=serializers.JSONField(), min_length=1, max_length=3
    )

    def validate_scenarios(self, value):
        return [contract(Scenario, item) for item in value]


class PreviewInput(ApiInput):
    scenario_index = serializers.IntegerField(min_value=0, max_value=2)


class ApplyInput(ApiInput):
    confirmation = serializers.CharField(max_length=2000)


class ReviewInput(ApiInput):
    expected_version = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(
        choices=[
            "assign",
            "request_information",
            "start",
            "reject",
            "recheck",
            "domain_action",
        ]
    )
    reason = serializers.CharField(max_length=500, allow_blank=False)
    assignee_id = serializers.IntegerField(required=False)
    domain_action = serializers.ChoiceField(
        choices=[
            "confirm_material",
            "transcribe",
            "authorize_ocr",
            "decide_loan",
            "verify_beneficiary",
            "reconcile_payment",
        ],
        required=False,
    )
    payload = serializers.JSONField(default=dict)
