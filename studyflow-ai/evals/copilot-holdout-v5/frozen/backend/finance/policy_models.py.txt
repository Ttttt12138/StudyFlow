import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q

from .models import OwnedRecord

APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "USED"]


class PolicyLimit(models.Model):
    """Per-currency outflow limits for T2 actions; global, admin-editable."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.CharField(max_length=40, default="outflow")
    currency = models.CharField(max_length=3)
    per_transaction = models.DecimalField(max_digits=16, decimal_places=2)
    daily = models.DecimalField(max_digits=18, decimal_places=2)
    monthly = models.DecimalField(max_digits=18, decimal_places=2)
    enabled = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["action", "currency"]
        constraints = [
            models.UniqueConstraint(fields=["action", "currency"], name="policy_limit_action_currency_unique"),
            models.CheckConstraint(
                condition=Q(per_transaction__gt=0, daily__gte=F("per_transaction"), monthly__gte=F("daily")),
                name="policy_limit_ordered"),
        ]


class ApprovalRequest(OwnedRecord):
    """Dual-control approval for a T3 action; the approver must differ from the requester."""
    action = models.CharField(max_length=40)
    target_id = models.UUIDField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3)
    reason = models.CharField(max_length=500)
    status = models.CharField(max_length=20, default="PENDING",
                              choices=[(s, s.title()) for s in APPROVAL_STATUSES])
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(decided_by__isnull=True) | ~Q(decided_by=F("requested_by")),
                                   name="approval_decider_not_requester"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="approval_positive_amount"),
            models.CheckConstraint(condition=Q(status__in=APPROVAL_STATUSES), name="approval_status_valid"),
            models.UniqueConstraint(fields=["owner", "action", "target_id"],
                                    condition=Q(status__in=["PENDING", "APPROVED"]),
                                    name="approval_one_open_per_target"),
        ]


class StepUpGrant(OwnedRecord):
    """One re-authentication, bound to a single action on a single target; used once."""
    nonce = models.CharField(max_length=64, unique=True)
    action = models.CharField(max_length=40)
    target_id = models.UUIDField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
