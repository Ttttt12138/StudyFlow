from django.db import models
from django.db.models import Q

from .models import OwnedRecord

SESSION_STATUSES = ["RUNNING", "COMPLETED", "FAILED"]
STEP_STATUSES = ["OK", "ERROR", "PROPOSED", "DENIED", "FINAL"]
PENDING_STATUSES = ["PENDING", "CONFIRMED", "REJECTED", "EXPIRED", "FAILED"]


class AgentSession(OwnedRecord):
    idempotency_key = models.CharField(max_length=100)
    goal = models.CharField(max_length=2000)
    locale = models.CharField(max_length=2, choices=[("zh", "Chinese"), ("en", "English")])
    mode = models.CharField(max_length=10)
    status = models.CharField(max_length=20, default="RUNNING",
                              choices=[(s, s.title()) for s in SESSION_STATUSES])
    final_answer = models.TextField(blank=True)
    error_code = models.CharField(max_length=40, blank=True)
    write_count = models.PositiveSmallIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "idempotency_key"], name="agent_session_key_unique"),
            models.CheckConstraint(condition=Q(status__in=SESSION_STATUSES), name="agent_session_status_valid"),
        ]


class AgentStep(OwnedRecord):
    """Append-only record of one planner decision and its tool outcome."""
    session = models.ForeignKey(AgentSession, on_delete=models.PROTECT, related_name="steps")
    number = models.PositiveSmallIntegerField()
    tool = models.CharField(max_length=40, blank=True)
    tier = models.CharField(max_length=2, blank=True)
    arguments = models.JSONField(default=dict)
    rationale = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=[(s, s.title()) for s in STEP_STATUSES])
    result = models.JSONField(default=dict)
    call = models.JSONField(default=dict)

    class Meta:
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(fields=["session", "number"], name="agent_step_number_unique"),
            models.CheckConstraint(condition=Q(status__in=STEP_STATUSES), name="agent_step_status_valid"),
        ]


class AgentPendingAction(OwnedRecord):
    """A T2 action the agent proposed; only the student can confirm it."""
    session = models.ForeignKey(AgentSession, on_delete=models.PROTECT, related_name="pending_actions")
    step = models.OneToOneField(AgentStep, on_delete=models.PROTECT)
    action = models.CharField(max_length=40)
    tool = models.CharField(max_length=40)
    arguments = models.JSONField(default=dict)
    target_id = models.UUIDField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3)
    status = models.CharField(max_length=20, default="PENDING",
                              choices=[(s, s.title()) for s in PENDING_STATUSES])
    expires_at = models.DateTimeField()
    decided_at = models.DateTimeField(null=True, blank=True)
    result = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(status__in=PENDING_STATUSES), name="agent_pending_status_valid"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="agent_pending_positive_amount"),
            models.UniqueConstraint(fields=["owner", "action", "target_id"], condition=Q(status="PENDING"),
                                    name="agent_pending_one_open_per_target"),
        ]
