from typing import ClassVar

from django.conf import settings
from django.db import models

from finance.models import OwnedRecord


class WhatIfRun(OwnedRecord):
    semester = models.ForeignKey("finance.Semester", on_delete=models.PROTECT)
    dependencies = models.JSONField()
    inputs = models.JSONField()
    result = models.JSONField()
    applied_index = models.IntegerField(null=True)
    application = models.JSONField(default=dict)


class PlanningPreference(OwnedRecord):
    semester = models.OneToOneField("finance.Semester", on_delete=models.PROTECT)
    allow_new_loan = models.BooleanField(default=True)
    source_run = models.ForeignKey(WhatIfRun, on_delete=models.PROTECT)


class ReviewItem(OwnedRecord):
    key = models.CharField(max_length=200)
    kind = models.CharField(max_length=40)
    entity_id = models.UUIDField()
    status = models.CharField(max_length=30, default="OPEN")
    version = models.PositiveIntegerField(default=1)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="copilot_reviews",
    )
    details = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(fields=["owner", "key"], name="copilot_review_key")
        ]


class ReviewAction(OwnedRecord):
    item = models.ForeignKey(ReviewItem, on_delete=models.PROTECT)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="copilot_review_actions",
    )
    action = models.CharField(max_length=40)
    reason = models.CharField(max_length=500)
    before = models.JSONField()
    after = models.JSONField()


class ExplanationTrace(OwnedRecord):
    trace_id = models.CharField(max_length=64)
    entity_id = models.UUIDField()
    layers = models.JSONField()

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["owner", "trace_id"], name="copilot_trace_key"
            )
        ]
