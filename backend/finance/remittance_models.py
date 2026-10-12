from django.conf import settings
from django.db import models
from django.db.models import Q

from .models import OwnedRecord

ORDER_STATUSES = ["CREATED", "SUBMITTED", "IN_TRANSIT", "DELIVERED", "RECONCILED",
                  "CANCELLED", "EXPIRED", "UNKNOWN", "REFUNDED"]
PURPOSES = ["tuition", "living", "family_support", "other"]


class RemittanceOrder(OwnedRecord):
    """Simulated cross-border transfer from one of the owner's wallet balances."""
    quote = models.OneToOneField("finance.FXQuote", on_delete=models.PROTECT)
    corridor = models.ForeignKey("finance.Corridor", on_delete=models.PROTECT)
    recipient = models.CharField(max_length=20, choices=[("SELF", "Self"), ("BENEFICIARY", "Beneficiary")])
    beneficiary = models.ForeignKey("finance.Beneficiary", null=True, blank=True, on_delete=models.PROTECT)
    purpose = models.CharField(max_length=20, choices=[(p, p.replace("_", " ").title()) for p in PURPOSES])
    reference = models.CharField(max_length=140, blank=True)
    send_currency = models.CharField(max_length=3)
    send_amount = models.DecimalField(max_digits=16, decimal_places=2)
    sender_fee = models.DecimalField(max_digits=16, decimal_places=2)
    rate = models.DecimalField(max_digits=24, decimal_places=10)
    mid_rate = models.DecimalField(max_digits=24, decimal_places=10)
    receive_currency = models.CharField(max_length=3)
    receive_amount = models.DecimalField(max_digits=18, decimal_places=2)
    deadline = models.DateField(null=True, blank=True)
    expected_earliest = models.DateField(null=True, blank=True)
    expected_latest = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, default="CREATED", choices=[(s, s.title()) for s in ORDER_STATUSES])
    version = models.PositiveIntegerField(default=1)
    submitted_at = models.DateTimeField(null=True, blank=True)
    delivered_on = models.DateField(null=True, blank=True)
    failure_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(status__in=ORDER_STATUSES), name="remittance_status_valid"),
            models.CheckConstraint(
                condition=(Q(recipient="SELF", beneficiary__isnull=True)
                           | Q(recipient="BENEFICIARY", beneficiary__isnull=False)),
                name="remittance_recipient_consistent"),
            models.CheckConstraint(
                condition=Q(send_amount__gt=0, receive_amount__gt=0, sender_fee__gte=0),
                name="remittance_positive_amounts"),
            models.CheckConstraint(condition=~Q(send_currency=models.F("receive_currency")),
                                   name="remittance_distinct_currencies"),
        ]


class RemittanceStatusEvent(OwnedRecord):
    """Append-only status history of a remittance order."""
    order = models.ForeignKey(RemittanceOrder, on_delete=models.PROTECT, related_name="history")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    version = models.PositiveIntegerField()
    note = models.CharField(max_length=500, blank=True)
    details = models.JSONField(default=dict)

    class Meta:
        ordering = ["created_at", "version"]
        constraints = [models.UniqueConstraint(fields=["order", "version"], name="remittance_event_version_unique")]
