from django.core.management.base import BaseCommand

from finance.readiness.ocr import purge_expired_sources


class Command(BaseCommand):
    help = "Purge expired terminal imports' source binaries and OCR caches; retain financial evidence."

    def handle(self, *args, **options):
        self.stdout.write(str(purge_expired_sources()))
