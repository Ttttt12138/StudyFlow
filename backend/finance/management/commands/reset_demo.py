"""Wipe a dedicated demo database and reseed the reference demo accounts (docs/demo-script.md)."""

import json
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from rest_framework.authtoken.models import Token

from finance.corridors import ensure_default_corridors
from finance.management.commands.demo_payment_ready import prepare_payment_ready
from finance.policy_defaults import ensure_default_limits

PAYER = "demo-payer"


class Command(BaseCommand):
    help = ("Delete EVERY record in this database, then recreate demo-student, demo-operator, demo-approver "
            "and demo-payer (tuition ready to pay). Needs STUDYFLOW_ALLOW_DEMO_RESET=true and --yes.")

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Confirm that this database may be wiped.")

    def handle(self, *args, **options):
        if not settings.STUDYFLOW_ALLOW_DEMO_RESET:
            raise CommandError("Refusing to wipe: set STUDYFLOW_ALLOW_DEMO_RESET=true on a dedicated demo database.")
        if not options["yes"]:
            raise CommandError("Refusing to wipe without --yes.")
        # TRUNCATE; the append-only history triggers are row-level and only guard UPDATE/DELETE.
        call_command("flush", interactive=False, verbosity=0)
        call_command("createcachetable", verbosity=0)
        # flush keeps the cache table, and recreated users get the same ids (sequences restart), so
        # rate-limit counters such as step-up attempts would carry over into the fresh demo.
        cache.clear()
        ensure_default_corridors()
        ensure_default_limits()
        call_command("seed_demo", stdout=self.stdout)

        demo, ids = prepare_payment_ready()
        users = get_user_model().objects
        users.filter(pk=demo.student.pk).update(username=PAYER)
        # The setup's scripted staff only prepared data; keep their records, retire their access.
        for role, user in [("operator", demo.operator), ("approver", demo.approver)]:
            user.username = f"demo-setup-{role}"
            user.set_unusable_password()
            user.save(update_fields=["username", "password"])
            Token.objects.filter(user=user).delete()

        path = Path(settings.BASE_DIR) / ".demo-credentials.json"
        credentials = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        credentials["payer"] = {"username": PAYER, "password": demo.policy.password,
                                "token": Token.objects.get(user_id=demo.student.pk).key}
        path.write_text(json.dumps(credentials, indent=2), encoding="utf-8")
        ids_path = Path(settings.BASE_DIR) / "examples" / "demo-ids.json"
        public = json.loads(ids_path.read_text(encoding="utf-8")) if ids_path.exists() else {}
        public["payer"] = {"username": PAYER, **ids}
        ids_path.write_text(json.dumps(public, indent=2), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(
            "Demo reset. Accounts: demo-student, demo-operator, demo-approver, demo-payer. "
            "Private login details: .demo-credentials.json (gitignored)."))
