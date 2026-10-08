import uuid
from typing import ClassVar

from django.db import models

from finance.models import OwnedRecord


class Semester(OwnedRecord):
    template_key = models.CharField(max_length=100)
    version = models.PositiveIntegerField(default=1)
    analysis_version = models.PositiveIntegerField(default=0)
    template_version = models.PositiveIntegerField(default=1)
    draft = models.JSONField(default=dict)
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["owner"],
                condition=models.Q(enabled=True),
                name="one_active_readiness_semester",
            )
        ]


class ReadinessRun(OwnedRecord):
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    state_version = models.PositiveIntegerField()
    budget_version = models.PositiveIntegerField()
    analysis_version = models.PositiveIntegerField(default=0)
    kind = models.CharField(max_length=20)
    inputs = models.JSONField(default=dict)
    result = models.JSONField(default=dict)


class ImportMaterial(OwnedRecord):
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    kind = models.CharField(max_length=10)
    content = models.BinaryField()
    sha256 = models.CharField(max_length=64)
    status = models.CharField(max_length=20, default="QUEUED")
    result = models.JSONField(default=dict)
    confirmation = models.JSONField(default=dict)
    processing = models.JSONField(default=dict)
    state_version = models.PositiveIntegerField()
    budget_version = models.PositiveIntegerField()

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["semester", "sha256"], name="readiness_material_unique"
            )
        ]


class InvoiceIdentity(OwnedRecord):
    issuer = models.CharField(max_length=200)
    invoice_id = models.CharField(max_length=200)
    fingerprint = models.CharField(max_length=64)
    material = models.ForeignKey(ImportMaterial, on_delete=models.PROTECT)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["owner", "issuer", "invoice_id"],
                name="readiness_invoice_unique",
            )
        ]


class ReadinessJob(OwnedRecord):
    key = models.CharField(max_length=200, unique=True)
    kind = models.CharField(max_length=20)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default="QUEUED")
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField()
    lease_until = models.DateTimeField(null=True)
    lease_token = models.UUIDField(null=True)
    error_code = models.CharField(max_length=100, blank=True)
    result = models.JSONField(default=dict)


class CheckLease(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    token = models.UUIDField(default=uuid.uuid4)
    expires_at = models.DateTimeField()
    result = models.JSONField(null=True)


class RiskCard(OwnedRecord):
    semester = models.ForeignKey(Semester, on_delete=models.PROTECT)
    kind = models.CharField(max_length=30)
    active = models.BooleanField(default=True)
    fingerprint = models.CharField(max_length=64)
    details = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["semester", "kind"], name="readiness_risk_unique"
            )
        ]


class NotificationOutbox(OwnedRecord):
    risk = models.ForeignKey(RiskCard, on_delete=models.PROTECT)
    transition = models.CharField(max_length=20)
    payload = models.JSONField(default=dict)
    read_at = models.DateTimeField(null=True)
