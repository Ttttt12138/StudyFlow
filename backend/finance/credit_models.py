from django.db import models
from django.db.models import Q

from .models import OwnedRecord

CREDIT_LEVELS = ["BUILDING", "FAIR", "GOOD", "AT_RISK"]


class CreditSnapshot(OwnedRecord):
    """Append-only computation of a student's simulated on-time record; not a bureau score."""
    level = models.CharField(max_length=20, choices=[(x, x.title()) for x in CREDIT_LEVELS])
    on_time = models.PositiveIntegerField()
    late = models.PositiveIntegerField()
    overdue = models.PositiveIntegerField()
    factors = models.JSONField(default=list)
    evidence = models.JSONField(default=list)
    as_of = models.DateField()

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.CheckConstraint(condition=Q(level__in=CREDIT_LEVELS), name="credit_level_valid")]
