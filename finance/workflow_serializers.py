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
    product_name = s.CharField(max_length=150)
    currency = s.ChoiceField(choices=CURRENCIES,default="THB")
    principal = MoneyField()
    annual_rate_percent = s.DecimalField(max_digits=7,decimal_places=4,min_value=0,max_value=100)
    repayment_months = s.IntegerField(min_value=1,max_value=360)
    grace_months = s.IntegerField(min_value=0,max_value=24,default=0)
    withheld_fee = MoneyField()
    disbursement_date = s.DateField()
    monthly_income = MoneyField(required=False,allow_null=True,default=None)
    monthly_essential_expenses = MoneyField(required=False,allow_null=True,default=None)
    income_confirmed = s.BooleanField(default=False)

class ApplicationInput(Input):
    loan_id = s.UUIDField()

class ApplicationAction(Input):
    action = s.ChoiceField(choices=["submit","cancel"])

class DecisionInput(Input):
    action = s.ChoiceField(choices=["review","approve","reject"])
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
