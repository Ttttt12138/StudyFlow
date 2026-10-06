from django.db import models
from django.db.models import Q
from .models import OwnedRecord, FinancialState

class FXQuote(OwnedRecord):
    route_name = models.CharField(max_length=100, default='Simulated route')
    quote_version = models.PositiveIntegerField(default=1)
    settlement_min_days = models.PositiveSmallIntegerField(default=0)
    source_currency = models.CharField(max_length=3)
    target_currency = models.CharField(max_length=3, default="THB")
    rate = models.DecimalField(max_digits=24, decimal_places=10)
    sender_fee = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    receiver_fee = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    settlement_days = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    is_mock = models.BooleanField(default=True)

class BudgetScenario(OwnedRecord):
    state = models.ForeignKey(FinancialState, on_delete=models.PROTECT)
    kind = models.CharField(max_length=20)
    revision = models.PositiveIntegerField()
    inputs = models.JSONField()
    result = models.JSONField()
    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner","kind","revision"], name="scenario_revision_unique")]

class LoanSimulation(OwnedRecord):
    inputs = models.JSONField()
    result = models.JSONField()
    engine_version = models.CharField(max_length=40, default="b-monthly-amortization-v1")

class FundingSource(OwnedRecord):
    economic_key = models.CharField(max_length=100)
    kind = models.CharField(max_length=30)
    currency = models.CharField(max_length=3)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    available_on = models.DateField()
    certainty = models.CharField(max_length=20)
    already_in_opening = models.BooleanField(default=False)
    received = models.BooleanField(default=False)
    loan = models.OneToOneField(LoanSimulation, null=True, blank=True, on_delete=models.PROTECT)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner","economic_key"], name="funding_economic_key_unique")]

class FundingPlan(OwnedRecord):
    scenario = models.ForeignKey(BudgetScenario, on_delete=models.PROTECT)
    inputs = models.JSONField()
    result = models.JSONField()

class SimulatedApplication(OwnedRecord):
    version = models.PositiveIntegerField(default=1)
    loan = models.OneToOneField(LoanSimulation, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, default="DRAFT")
    assessment = models.JSONField(default=dict)
    decision_reason = models.CharField(max_length=500, blank=True)

class Disbursement(OwnedRecord):
    application = models.OneToOneField(SimulatedApplication, on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    scheduled_on = models.DateField()
    status = models.CharField(max_length=20, default="scheduled")

class DemoWallet(OwnedRecord):
    initial_state = models.OneToOneField(FinancialState, on_delete=models.PROTECT)
    balance = models.DecimalField(max_digits=18, decimal_places=2)
    clock = models.DateField()
    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner"], name="one_demo_wallet_per_owner")]

class Beneficiary(OwnedRecord):
    name = models.CharField(max_length=150)
    destination_label = models.CharField(max_length=150)
    verified = models.BooleanField(default=False)

class Payment(OwnedRecord):
    plan = models.ForeignKey(FundingPlan, null=True, on_delete=models.PROTECT)
    readiness_plan = models.ForeignKey('finance.ReadinessRun', null=True, on_delete=models.PROTECT)
    execution_context = models.JSONField(default=dict)
    invoice_snapshot = models.JSONField(default=dict)
    state = models.ForeignKey(FinancialState, on_delete=models.PROTECT)
    beneficiary = models.ForeignKey(Beneficiary, on_delete=models.PROTECT)
    event_id = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    due_on = models.DateField()
    status = models.CharField(max_length=30, default="draft")
    authorized_until = models.DateTimeField(null=True)
    receipt = models.JSONField(null=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=(Q(plan__isnull=False, readiness_plan__isnull=True) | Q(plan__isnull=True, readiness_plan__isnull=False)), name='payment_exactly_one_plan'), models.UniqueConstraint(
            fields=["owner","event_id"],
            condition=~Q(status__in=["failed","cancelled","expired"]),
            name="one_active_or_settled_payment_per_event",
        )]

class DemoLedgerEntry(OwnedRecord):
    installment = models.OneToOneField("finance.LoanInstallment", null=True, on_delete=models.PROTECT)
    sequence = models.PositiveIntegerField(default=1)
    funding_source = models.OneToOneField(FundingSource, null=True, on_delete=models.PROTECT)
    disbursement = models.OneToOneField(Disbursement, null=True, on_delete=models.PROTECT)
    payment = models.OneToOneField(Payment, null=True, on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    effective_on = models.DateField()
    class Meta:
        constraints = [models.CheckConstraint(
            condition=((Q(disbursement__isnull=False,payment__isnull=True,funding_source__isnull=True,amount__gt=0) |
                       Q(disbursement__isnull=True,payment__isnull=False,funding_source__isnull=True,amount__lt=0) |
                       Q(disbursement__isnull=True,payment__isnull=True,funding_source__isnull=False,amount__gt=0)) & Q(installment__isnull=True)) |
                       Q(disbursement__isnull=True,payment__isnull=True,funding_source__isnull=True,installment__isnull=False,amount__lt=0),
            name="ledger_origin_and_sign",
        ), models.UniqueConstraint(fields=["owner","sequence"], name="ledger_owner_sequence_unique")]

class IdempotencyRecord(OwnedRecord):
    scope = models.CharField(max_length=150)
    key = models.CharField(max_length=100)
    request_hash = models.CharField(max_length=64)
    response = models.JSONField()
    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner","scope","key"], name="request_idempotency_unique")]
