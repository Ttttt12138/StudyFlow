import time
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from finance.readiness.jobs import run_one, schedule_daily


class Command(BaseCommand):
    help = "Consume persistent readiness jobs and schedule daily checks; run separately from HTTP workers."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--poll-seconds", type=int, default=5)
        parser.add_argument("--env-file", type=Path)
        parser.add_argument("--mode", choices=["mock", "live"])

    def handle(self, *args, **options):
        if options["env_file"]:
            from studyflow_ai.config import load_env_file

            load_env_file(options["env_file"])
        if options["mode"]:
            settings.STUDYFLOW_AI_MODE = options["mode"]
        if not settings.STUDYFLOW_READINESS_ENABLED:
            raise CommandError("Set STUDYFLOW_READINESS_ENABLED=true")
        while True:
            schedule_daily()
            worked = run_one()
            if options["once"]:
                self.stdout.write("processed" if worked else "idle")
                return
            if not worked:
                time.sleep(max(1, min(30, options["poll_seconds"])))
