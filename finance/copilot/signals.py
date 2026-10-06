from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from finance.models import AuditEvent
from finance.readiness.models import ImportMaterial, ReadinessRun
from finance.remittance_models import RemittanceOrder
from finance.workflow_models import Beneficiary, Payment, SimulatedApplication

from . import explanations, reviews
from .models import WhatIfRun


@receiver(post_save, sender=ImportMaterial, dispatch_uid="copilot_material")
@receiver(post_save, sender=Beneficiary, dispatch_uid="copilot_beneficiary")
@receiver(post_save, sender=Payment, dispatch_uid="copilot_payment")
@receiver(post_save, sender=SimulatedApplication, dispatch_uid="copilot_application")
@receiver(post_save, sender=RemittanceOrder, dispatch_uid="copilot_remittance")
def sync_review(sender, instance, raw=False, **kwargs):
    if not raw and settings.STUDYFLOW_READINESS_ENABLED:
        reviews.sync(instance)


@receiver(post_save, sender=ImportMaterial, dispatch_uid="copilot_material_trace")
@receiver(post_save, sender=ReadinessRun, dispatch_uid="copilot_run_trace")
@receiver(post_save, sender=WhatIfRun, dispatch_uid="copilot_scenario_trace")
def capture(sender, instance, raw=False, **kwargs):
    if not raw and settings.STUDYFLOW_READINESS_ENABLED:
        explanations.capture(instance)


@receiver(post_save, sender=AuditEvent, dispatch_uid="copilot_policy_trace")
def capture_policy(sender, instance, raw=False, **kwargs):
    if not raw and settings.STUDYFLOW_READINESS_ENABLED:
        explanations.capture_audit(instance)
