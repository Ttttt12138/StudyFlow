"""Complete synthetic financial copilot journey over authenticated loopback HTTP."""

import json
import threading
import time
from pathlib import Path
from uuid import uuid4
from wsgiref.simple_server import make_server

from django.core.management.base import BaseCommand
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from finance.management.commands.demo_readiness import Demo, QuietHandler, require
from finance.policy_flow import scripted_throttling
from finance.readiness.models import ReadinessJob


class CopilotDemo(Demo):
    def __init__(self, base_url):
        super().__init__(base_url)
        self.steps = []

    def request(self, route, body=None, operator=False, key=None, **kwargs):
        started = time.perf_counter()
        try:
            result = super().request(route, body, operator, key, **kwargs)
        except Exception as exc:
            self.steps.append(
                {"route": route, "status": "FAILED", "error_code": type(exc).__name__}
            )
            raise
        self.steps.append(
            {
                "route": route,
                "status": "DONE",
                "actor": kwargs.get("role") or ("operator" if operator else "student"),
                "record_id": result.get("id") if isinstance(result, dict) else None,
                "versions": {
                    k: result[k]
                    for k in ("state_version", "budget_version", "analysis_version")
                    if isinstance(result, dict) and k in result
                },
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        )
        return result

    def context(self):
        data = self.request("readiness/state")
        return {
            k: data[k]
            for k in (
                "semester_id",
                "state_version",
                "budget_version",
                "analysis_version",
            )
        }

    def draft(self, semester):
        draft = super().draft(semester)
        next(c for c in draft["costs"] if c["cost_id"] == "tuition").update(
            beneficiary_id=self.beneficiary["id"], invoice_id="DEMO-175"
        )
        return draft

    def prepare(self):
        # The admission import is confirmed against this explicitly verified synthetic payee.
        self.beneficiary = self.request(
            "beneficiaries", {"name": "Synthetic PSU", "destination_label": "DEMO-PSU"}
        )
        self.request(
            "beneficiaries/" + self.beneficiary["id"] + "/verify",
            {"verified": True},
            operator=True,
        )
        return super().prepare()

    def sponsor(self):
        request = self.request(
            "sponsor-requests",
            {
                "economic_key": "family-demo",
                "amount": "20000.00",
                "currency": "THB",
                "available_on": "2026-08-01",
                "purpose": "Synthetic tuition support",
            },
        )
        link = self.request(
            "sponsor-requests/" + request["id"] + "/issue-link",
            {"terms_version": 1},
            operator=True,
        )
        response = self.http.post(
            "sponsor-confirmation/",
            headers={"X-Sponsor-Token": link["token"], "Idempotency-Key": uuid4().hex},
            json={"terms_version": 1, "decision": "confirm"},
        )
        require(response.status_code == 200, "Sponsor confirmation failed")
        self.steps.append(
            {
                "route": "sponsor-confirmation",
                "status": "DONE",
                "actor": "simulated_sponsor",
            }
        )
        self.request(
            "funding-sources/" + request["source"]["id"] + "/receive", {}, operator=True
        )
        return request["id"]

    def borrow(self):
        recommendation = self.request(
            "readiness/funding-plans/recommend", self.context()
        )
        require(
            recommendation["result"]["recommended_borrowing_net"] == "30000.00",
            "Unexpected residual borrowing",
        )
        quote = self.request(
            "loans",
            {
                "principal": "30600.00",
                "fees": "600.00",
                "annual_rate": "0",
                "months": 12,
                "first_due_date": "2026-09-05",
            },
        )
        profile = self.request("affordability-profile")
        months = [
            {
                "month": r["due_date"][:7],
                "income": "10000.00",
                "living_expenses": "4000.00",
                "existing_repayments": "0.00",
            }
            for r in quote["result"]["schedule"]
            if r["payment"] != "0.00"
        ]
        self.request(
            "affordability-profile",
            {"expected_version": profile["version"], "months": months},
        )
        application = self.request("applications", {"quote_id": quote["id"]})
        application = self.request(
            "applications/" + application["id"] + "/action",
            {"expected_version": application["version"], "action": "submit"},
        )
        require(application["status"] == "APPROVED", "Loan not approved")
        return self.request(
            "applications/" + application["id"] + "/disburse",
            {"expected_version": application["version"]},
            operator=True,
        )

    def create_payment(self):
        plan = self.request(
            "readiness/funding-plans", {**self.context(), "allocations": []}
        )
        require(plan["result"]["validation"] == "VALID", "Payment plan not executable")
        body = {
            "readiness_plan_id": plan["id"],
            "event_id": "cost:tuition:2026-08-10",
            "beneficiary_id": self.beneficiary["id"],
        }
        return self.request("payments", body), body

    def pay(self):
        payment, _ = self.create_payment()
        route = "payments/" + payment["id"]
        self.request(
            route + "/authorize", {"state_version": self.context()["state_version"]}
        )
        self.request(route + "/submit", {})
        self.request(route + "/adapter-event", {"outcome": "settled"}, operator=True)
        result = self.request(route + "/reconcile", {})
        require(result["status"] == "reconciled", "Payment not reconciled")
        return result

    def run(self):
        extraction = self.prepare()
        budget = self.request("readiness/budgets", self.context())
        require(budget["result"]["gap"] == "50000.00", "Initial gap mismatch")
        support = self.sponsor()
        loan = self.borrow()
        job = self.request("readiness/checks", self.context())
        checked = self.drain(job["id"])
        require(checked["status"] == "DONE", "Model planning failed")
        payment = self.pay()
        latest = ReadinessJob.objects.filter(owner=self.student, kind="check").latest(
            "created_at"
        )
        after = self.drain(latest.id)
        require(after["status"] == "DONE", "Forecast update failed")
        forecast = self.request(
            "readiness/forecasts", {**self.context(), "horizon": 90}
        )
        require(
            forecast["result"]["maximum_reserve_gap"] == "0.00",
            "Post-payment reserve gap",
        )
        return {
            "extraction": extraction,
            "budget": budget,
            "support_request_id": support,
            "loan": loan,
            "planning": checked,
            "payment": payment,
            "policy": self.policy.log,
            "after_payment_check": after,
            "forecast": forecast,
        }


class Command(BaseCommand):
    help = "One-command admission → funding → loan → simulated tuition → updated forecast demo."

    def add_arguments(self, parser):
        parser.add_argument("--mode", choices=["mock", "live"], default="mock")
        parser.add_argument("--runs", type=int, default=1)
        parser.add_argument("--env-file", type=Path)
        parser.add_argument(
            "--scenario",
            default="main",
            choices=[
                "main",
                "all",
                "conflicting_tuition",
                "abnormal_amount",
                "duplicate_payment",
                "insufficient_funds",
                "beneficiary_changed",
                "model_failure",
                "payment_failure",
                "ocr_failure",
                "stale_version",
                "reconciliation_mismatch",
            ],
        )
        parser.add_argument("--output", type=Path)

    def handle(self, *args, **options):
        from studyflow_ai.config import load_env_file

        if options["env_file"]:
            load_env_file(options["env_file"])
        require(1 <= options["runs"] <= 10, "Runs must be 1–10")
        destination = options["output"] or Path("output") / (
            "copilot-" + uuid4().hex + ".json"
        )
        require(
            not destination.exists(), "Output already exists; use a new report path"
        )
        report = {
            "passed": False,
            "mode": options["mode"],
            "synthetic": True,
            "is_simulated": True,
            "transport": "real_loopback_http",
            "database": "postgresql",
            "runs": [],
        }
        with override_settings(
            STUDYFLOW_READINESS_ENABLED=True,
            STUDYFLOW_CONSUMPTION_ENABLED=False,
            STUDYFLOW_AI_MODE=options["mode"],
            ALLOWED_HOSTS=["127.0.0.1", "localhost"],
        ), scripted_throttling() as throttling:
            report["throttling"] = throttling
            server = make_server(
                "127.0.0.1", 0, get_wsgi_application(), handler_class=QuietHandler
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                self.run_scenarios(options, report, server.server_port)
                report["passed"] = True
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        self.stdout.write(f"Copilot passed; report: {destination}")

    def run_scenarios(self, options, report, port):
        from finance.copilot.demo_failures import SCENARIOS, run_failure

        names = (
            ["main", *SCENARIOS]
            if options["scenario"] == "all"
            else [options["scenario"]]
        )
        for _ in range(options["runs"]):
            for name in names:
                demo = CopilotDemo(f"http://127.0.0.1:{port}")
                row = {
                    "run_id": demo.run_id,
                    "scenario": name,
                    "passed": False,
                    "steps": demo.steps,
                }
                report["runs"].append(row)
                try:
                    row["result"] = (
                        demo.run() if name == "main" else run_failure(demo, name)
                    )
                    row["passed"] = True
                    self.stdout.write(f"{name}: passed")
                except Exception as exc:
                    row["error_code"] = type(exc).__name__
                    raise
                finally:
                    demo.http.close()
