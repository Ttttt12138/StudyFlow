from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from finance.models import FinancialState
from finance.workflow_models import (
    DemoWallet,
    FundingSource,
    FXQuote,
    SimulatedApplication,
)


@receiver(post_save, sender=FinancialState, dispatch_uid="readiness_state_changed")
def state_changed(sender, instance, **kwargs):
    if settings.STUDYFLOW_READINESS_ENABLED:
        from .jobs import enqueue_check

        enqueue_check(instance.owner, "state_changed")


@receiver(post_save, sender=FundingSource, dispatch_uid="readiness_source_changed")
@receiver(post_save, sender=FXQuote, dispatch_uid="readiness_fx_changed")
@receiver(post_save, sender=SimulatedApplication, dispatch_uid="readiness_loan_changed")
@receiver(post_save, sender=DemoWallet, dispatch_uid="readiness_clock_changed")
def context_changed(sender, instance, **kwargs):
    if not settings.STUDYFLOW_READINESS_ENABLED:
        return
    from .jobs import enqueue_check
    from .models import Semester

    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=instance.owner_id)
        semester = Semester.objects.filter(owner=instance.owner, enabled=True).first()
        if semester:
            semester.version += 1
            semester.save(update_fields=["version"])
            enqueue_check(instance.owner, "context_changed")
