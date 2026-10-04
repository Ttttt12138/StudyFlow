import uuid
from django.conf import settings
from django.db import models

class OwnedRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        abstract = True

class SourceDocument(OwnedRecord):
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=[
        ("upload", "Upload"), ("official_url", "Official URL"), ("import", "Import"),
    ])
    url = models.URLField(blank=True)
    note = models.TextField(blank=True, max_length=4000)

class FinancialState(OwnedRecord):
    version = models.PositiveIntegerField()
    snapshot = models.JSONField()
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "version"], name="state_owner_version_unique"),
            models.CheckConstraint(condition=models.Q(version__gte=1), name="state_version_positive"),
        ]
        ordering = ["-version"]

class CalculationRun(OwnedRecord):
    state = models.ForeignKey(FinancialState, on_delete=models.PROTECT)
    engine_version = models.CharField(max_length=40, default="cashflow-thb-v1")
    inputs = models.JSONField()
    result = models.JSONField()

class AuditEvent(OwnedRecord):
    action = models.CharField(max_length=80)
    entity_id = models.UUIDField()
    details = models.JSONField(default=dict)

# Register the bounded v2 workflow models with Django.
from .workflow_models import (FXQuote, BudgetScenario, LoanSimulation, FundingSource, FundingPlan, SimulatedApplication, Disbursement, DemoWallet, Beneficiary, Payment, DemoLedgerEntry, IdempotencyRecord)
