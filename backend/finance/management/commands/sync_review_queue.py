from django.core.management.base import BaseCommand

from finance.copilot.reviews import sync
from finance.readiness.models import ImportMaterial, ReadinessJob
from finance.workflow_models import Beneficiary, Payment, SimulatedApplication


class Command(BaseCommand):
    help = "Idempotently reconcile review items with current domain records."

    def handle(self, *args, **options):
        count = 0
        for model in (
            ImportMaterial,
            ReadinessJob,
            Beneficiary,
            Payment,
            SimulatedApplication,
        ):
            for item in model.objects.iterator():
                sync(item)
                count += 1
        self.stdout.write(
            f"Reconciled {count} domain records; historical decisions were not synthesized."
        )
