from decimal import Decimal
from rest_framework import serializers as s
from .serializers import StrictInputMixin, MoneyField

CURRENCIES = ["THB","USD","EUR","CNY","GBP","JPY"]

class Input(StrictInputMixin, s.Serializer):
    pass

class FXInput(Input):
    source_currency = s.ChoiceField(choices=CURRENCIES)
    target_currency = s.ChoiceField(choices=["THB"], default="THB")
    rate = s.DecimalField(max_digits=24,decimal_places=10,min_value=Decimal("0.0000000001"))
    sender_fee = MoneyField()
    receiver_fee = MoneyField()
    settlement_days = s.IntegerField(min_value=0,max_value=60)
    expires_at = s.DateTimeField()

class ExpenseOverride(Input):
    event_id = s.CharField(max_length=100)
    amount = MoneyField(allow_null=True)
    currency = s.ChoiceField(choices=CURRENCIES,default="THB")
    fx_quote_id = s.UUIDField(required=False,allow_null=True)
    certainty = s.ChoiceField(choices=["confirmed","estimated","missing"])

class ScenarioInput(Input):
    state_version = s.IntegerField(min_value=1)
    kind = s.ChoiceField(choices=["essential","expected","higher_cost"])
    end_date = s.DateField()
    include_estimates = s.BooleanField(default=False)
    overrides = ExpenseOverride(many=True,default=list,max_length=1000)

class SourceInput(Input):
    economic_key = s.CharField(max_length=100)
    kind = s.ChoiceField(choices=["family","scholarship","external_savings","loan"])
    currency = s.ChoiceField(choices=CURRENCIES)
    amount = MoneyField()
    available_on = s.DateField()
    certainty = s.ChoiceField(choices=["confirmed","estimated"])
    already_in_opening = s.BooleanField(default=False)
    loan_id = s.UUIDField(required=False,allow_null=True)

class Allocation(Input):
    source_id = s.UUIDField()
    amount = MoneyField()
    fx_quote_id = s.UUIDField(required=False,allow_null=True)

class PlanInput(Input):
    scenario_id = s.UUIDField()
    allocations = Allocation(many=True,max_length=100,allow_empty=True)

class LoanInput(Input):
    currency = s.ChoiceField(choices=["THB"], default="THB")
    principal = MoneyField()
    annual_rate = s.DecimalField(max_digits=9, decimal_places=8, min_value=0, max_value=1)
    fees = MoneyField()
    months = s.IntegerField(min_value=1, max_value=60)
    first_due_date = s.DateField()

    def validate(self, data):
        from .lending_core.schemas import QuoteInput
        from pydantic import ValidationError
        try:
            QuoteInput.model_validate(data)
        except ValidationError as error:
            raise s.ValidationError(str(error)) from None
        return data

    def to_internal_value(self, data):
        if isinstance(data, dict):
            if isinstance(data.get("annual_rate"), (float, bool)):
                raise s.ValidationError({"annual_rate": "Use an exact decimal string."})
            if type(data.get("months")) is not int:
                raise s.ValidationError({"months": "Use an integer."})
        return super().to_internal_value(data)

class ApplicationInput(Input):
    quote_id = s.UUIDField()

class ApplicationAction(Input):
    expected_version = s.IntegerField(min_value=1)
    action = s.ChoiceField(choices=["submit", "cancel"])

class DecisionInput(Input):
    expected_version = s.IntegerField(min_value=1)
    reason = s.CharField(max_length=500)

class SettlementInput(Input):
    action = s.ChoiceField(choices=["process","unknown","settle","fail"])

class InitializeInput(Input):
    state_version = s.IntegerField(min_value=1)

class ClockInput(Input):
    date = s.DateField()

class BeneficiaryInput(Input):
    name = s.CharField(max_length=150)
    destination_label = s.CharField(max_length=150)

class VerifyInput(Input):
    verified = s.BooleanField()

class PaymentInput(Input):
    plan_id = s.UUIDField()
    beneficiary_id = s.UUIDField()
    event_id = s.CharField(max_length=100)

class AuthorizationInput(Input):
    state_version = s.IntegerField(min_value=1)
    expires_in_seconds = s.IntegerField(min_value=60,max_value=3600,default=900)

class EmptyInput(Input):
    pass

class PaymentEventInput(Input):
    outcome = s.ChoiceField(choices=["settled","failed","unknown"])

class CommandResponse(s.Serializer):
    data = s.JSONField()

class HistoryResponse(s.Serializer):
    count = s.IntegerField()
    next = s.URLField(allow_null=True)
    previous = s.URLField(allow_null=True)
    results = s.ListField(child=s.JSONField())

class ReceiveInput(Input):
    fx_quote_id = s.UUIDField(required=False,allow_null=True)

class CompareInput(Input):
    loan_ids = s.ListField(child=s.UUIDField(),min_length=2,max_length=10)
