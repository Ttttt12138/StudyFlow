"""Prepare a synthetic student whose tuition bill is ready to pay on the payments page (?payments=1)."""

import json
import threading
from pathlib import Path
from wsgiref.simple_server import make_server

from django.core.management.base import BaseCommand
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from finance.management.commands.demo_consumption import TUITION_EVENT, ConsumptionDemo
from finance.management.commands.demo_readiness import QuietHandler
from finance.policy_flow import scripted_throttling


def prepare_payment_ready():
    """Run the synthetic setup up to (not including) the tuition payment; return the demo and its ids."""
    with override_settings(
        STUDYFLOW_READINESS_ENABLED=True,
        STUDYFLOW_CONSUMPTION_ENABLED=True,
        STUDYFLOW_AI_MODE="mock",
        ALLOWED_HOSTS=["127.0.0.1", "localhost"],
    ), scripted_throttling():
        # Same loopback HTTP setup as demo_consumption, so every step passes the real API checks.
        server = make_server("127.0.0.1", 0, get_wsgi_application(), handler_class=QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            demo = ConsumptionDemo(f"http://127.0.0.1:{server.server_port}")
            try:
                demo.prepare_learning()
                demo.sponsor_and_routes()
                beneficiary, plan = demo.tuition_plan()
            finally:
                demo.http.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    return demo, {"beneficiary_id": beneficiary["id"], "plan_id": plan["id"], "event_id": TUITION_EVENT}


class Command(BaseCommand):
    help = ("Create a synthetic student, operator and approver and stop just before the tuition payment, "
            "so the payment can be created, authorized, submitted and reconciled in the browser.")

    def add_arguments(self, parser):
        parser.add_argument("--output", type=Path, default=Path("output/payment-ready.json"))

    def handle(self, *args, **options):
        demo, ids = prepare_payment_ready()
        # Credentials stay in the ignored output/ folder; nothing secret is printed.
        options["output"].parent.mkdir(parents=True, exist_ok=True)
        options["output"].write_text(json.dumps({
            "is_simulated": True,
            "student": {"username": demo.student.username, "password": demo.policy.password},
            "operator": {"username": demo.operator.username, "token": demo.tokens["operator"]},
            "approver": {"username": demo.approver.username, "token": demo.tokens["approver"]},
            **ids,
        }, indent=2), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(
            f"Student {demo.student.username} has tuition {TUITION_EVENT} ready to pay. "
            f"Credentials: {options['output']} (gitignored)."))
