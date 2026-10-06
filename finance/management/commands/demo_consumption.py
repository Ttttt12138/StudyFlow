"""Synthetic end-to-end consumption, sponsor and tuition flow over real HTTP."""

import json
import threading
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from uuid import uuid4
from wsgiref.simple_server import make_server

from django.core.management.base import BaseCommand
from django.core.wsgi import get_wsgi_application
from django.test import override_settings
from django.utils import timezone

from finance.management.commands.demo_readiness import Demo, QuietHandler, require
from finance.policy_flow import scripted_throttling

FIXTURES = Path(__file__).resolve().parents[3] / "examples" / "consumption" / "v1"


class ConsumptionDemo(Demo):
    def context(self):
        state = self.request("readiness/state")
        return {
            k: state[k]
            for k in (
                "semester_id",
                "state_version",
                "budget_version",
                "analysis_version",
            )
        }

    def import_csv(self, name, complete=True):
        batch = self.request(
            "readiness/transaction-imports",
            data={"source_type": "synthetic"},
            files={"file": (name, (FIXTURES / name).read_bytes(), "text/csv")},
        )
        if batch["status"] != "COMMITTED":
            self.request(
                "readiness/transaction-imports/" + batch["id"] + "/confirm",
                {
                    "selected_rows": [r["locator"] for r in batch["preview"]["rows"]],
                    "coverage": [
                        {
                            "account_id": "demo-main",
                            "start": "2026-07-01",
                            "end": "2026-09-30",
                            "complete": complete,
                        }
                    ],
                },
            )
        self.drain()
        return batch["id"]

    def prepare_learning(self):
        semester = self.request(
            "readiness/semesters",
            {"reserve": "5000", "opening_balance": "65000", "as_of": "2026-10-01"},
        )
        self.request("demo/initialize", {"state_version": semester["state_version"]})
        draft = deepcopy(semester["draft"])
        draft["profile"]["start_date"] = "2026-10-01"
        for cost in draft["costs"]:
            cost.update(
                conflict=False,
                paid=False,
                synthetic=True,
                valid_until=None,
                source_refs=[],
                alternatives=[],
            )
            if cost["cost_id"] == "tuition":
                cost.update(amount="30000.00", due_date="2026-10-10")
            elif cost["cost_id"] in {"food", "housing", "communications", "transport"}:
                amount = {
                    "food": "3000.00",
                    "housing": "9000.00",
                    "communications": "500.00",
                    "transport": "1500.00",
                }[cost["cost_id"]]
                cost.update(
                    amount=amount, period="monthly", locked=cost["cost_id"] == "housing"
                )
            else:
                cost.update(
                    applicability="NOT_APPLICABLE",
                    applicability_reason="Synthetic demonstration scope",
                )
        self.request("readiness/semesters/revise", {**self.context(), "draft": draft})
        batch_id = self.import_csv("history.csv")
        before = self.request("readiness/briefing")
        require(
            any(c["applied"] for c in before["forecast_changes"]["costs"]),
            "Calibration did not apply",
        )
        require(
            self.request("readiness/state")["assets"]["wallet_balance"] == "65000.00",
            "CSV changed wallet",
        )
        return batch_id, before

    def sponsor_and_routes(self):
        request = self.request(
            "sponsor-requests",
            {
                "economic_key": "family-demo",
                "currency": "USD",
                "amount": "1000",
                "available_on": "2026-10-01",
                "purpose": "Synthetic tuition support",
            },
        )
        link = self.request(
            "sponsor-requests/" + request["id"] + "/issue-link",
            {"terms_version": 1},
            operator=True,
        )
        headers = {"X-Sponsor-Token": link["token"], "Idempotency-Key": uuid4().hex}
        preview = self.http.get("sponsor-confirmation/", headers=headers)
        require(preview.status_code == 200, "Sponsor preview failed")
        confirmation = self.http.post(
            "sponsor-confirmation/",
            headers=headers,
            json={"terms_version": 1, "decision": "confirm"},
        )
        require(confirmation.status_code == 200, "Sponsor confirmation failed")
        quotes = []
        for name, fee, days in [
            ("Demo Express", "20", 1),
            ("Demo Standard", "10", 1),
            ("Demo Economy", "0", 12),
        ]:
            quote = self.request(
                "fx-quotes",
                {
                    "route_name": name,
                    "source_currency": "USD",
                    "rate": "35",
                    "sender_fee": fee,
                    "receiver_fee": "0",
                    "settlement_min_days": days,
                    "settlement_days": days,
                    "expires_at": (timezone.now() + timedelta(hours=1)).isoformat(),
                },
            )
            quotes.append(quote["id"])
        comparison = self.request(
            "remittance-comparisons",
            {
                "quote_ids": quotes,
                "source_currency": "USD",
                "amount": "1000",
                "required_amount": "30000",
                "send_on": "2026-10-01",
                "deadline": "2026-10-10",
            },
        )
        require(
            comparison["recommended_quote_id"] == quotes[1],
            "Wrong remittance recommendation",
        )
        self.request("demo/clock", {"date": "2026-10-02"})
        self.request(
            "funding-sources/" + request["source"]["id"] + "/receive",
            {"fx_quote_id": comparison["recommended_quote_id"]},
            operator=True,
        )
        return {
            "request_id": request["id"],
            "confirmation": confirmation.json()["data"],
            "comparison": comparison,
        }

    def tuition(self):
        beneficiary = self.request(
            "beneficiaries",
            {"name": "Synthetic University", "destination_label": "DEMO-UNIVERSITY"},
        )
        self.request(
            "beneficiaries/" + beneficiary["id"] + "/verify",
            {"verified": True},
            operator=True,
        )
        material = self.request(
            "readiness/imports",
            data={**self.context(), "kind": "text"},
            files={
                "file": (
                    "invoice.txt",
                    b"Synthetic invoice DEMO-2026-1: tuition 30000 THB due 2026-10-10.",
                    "text/plain",
                )
            },
        )
        self.drain()
        material = self.request("readiness/imports/" + material["id"])
        require(material["status"] == "NEEDS_REVIEW", "Invoice extraction failed")
        semester = self.request("readiness/semesters/" + self.context()["semester_id"])
        draft = semester["draft"]
        cost = next(c for c in draft["costs"] if c["cost_id"] == "tuition")
        cost.update(invoice_id="DEMO-2026-1", beneficiary_id=beneficiary["id"])
        resolutions = {
            k: "Synthetic demo explicitly reviewed"
            for k in material["result"].get("merge_conflicts", {})
        }
        resolutions["tuition"] = "Synthetic invoice and beneficiary confirmed"
        self.request(
            "readiness/imports/" + material["id"] + "/confirm",
            {
                **self.context(),
                "draft": draft,
                "issuer": "Synthetic University",
                "selected_cost_ids": ["tuition"],
                "conflict_resolutions": resolutions,
            },
        )
        self.drain()
        plan = self.request(
            "readiness/funding-plans", {**self.context(), "allocations": []}
        )
        require(
            plan["result"]["validation"] == "VALID",
            "Tuition plan incomplete: "
            + str(plan["result"]["forecast"].get("data_issues")),
        )
        payment = self.request(
            "payments",
            {
                "readiness_plan_id": plan["id"],
                "event_id": "cost:tuition:2026-10-10",
                "beneficiary_id": beneficiary["id"],
            },
        )
        route = "payments/" + payment["id"]
        self.request(
            route + "/authorize", {"state_version": self.context()["state_version"]}
        )
        self.request(route + "/submit", {})
        self.request(route + "/adapter-event", {"outcome": "settled"}, operator=True)
        reconciled = self.request(route + "/reconcile", {})
        require(reconciled["status"] == "reconciled", "Invoice reconciliation failed")
        return reconciled

    def lending_risk(self):
        quote = self.request(
            "loans",
            {
                "principal": "10000",
                "fees": "0",
                "annual_rate": "0.12",
                "months": 6,
                "first_due_date": "2026-11-01",
            },
        )
        profile = self.request("affordability-profile")
        months = [
            {
                "month": row["due_date"][:7],
                "income": "20000",
                "living_expenses": "5000",
                "existing_repayments": "0",
            }
            for row in quote["result"]["repayments"]
        ]
        self.request(
            "affordability-profile",
            {"expected_version": profile["version"], "months": months},
        )
        app = self.request("applications", {"quote_id": quote["id"]})
        app = self.request(
            "applications/" + app["id"] + "/action",
            {"expected_version": 1, "action": "submit"},
        )
        require(app["status"] == "APPROVED", "Synthetic loan approval failed")
        self.request(
            "applications/" + app["id"] + "/disburse",
            {"expected_version": app["version"]},
            operator=True,
        )
        self.import_csv("rising-costs.csv", complete=False)
        after = self.request("readiness/briefing")
        require(
            "repayment_liquidity" in after["risks"], "Post-loan risk was not detected"
        )
        return after

    def run(self):
        try:
            batch, before = self.prepare_learning()
            support = self.sponsor_and_routes()
            payment = self.tuition()
            after = self.lending_risk()
            return {
                "run_id": self.run_id,
                "transport": "real_loopback_http",
                "database": "postgresql",
                "synthetic": True,
                "model_mode": "mock",
                "batch_id": batch,
                "before": before,
                "support": support,
                "payment": payment,
                "policy": self.policy.log,
                "after": after,
            }
        finally:
            self.http.close()


class Command(BaseCommand):
    help = "Demonstrate CSV learning, sponsor confirmation, simulated tuition and post-loan monitoring over HTTP."

    def add_arguments(self, parser):
        parser.add_argument("--runs", type=int, default=1)
        parser.add_argument(
            "--output", type=Path, default=Path("output/consumption-http-demo.json")
        )

    def handle(self, *args, **options):
        require(1 <= options["runs"] <= 10, "Runs must be 1-10")
        report = {"passed": False, "dataset_version": "consumption-v1", "runs": []}
        options["output"].parent.mkdir(parents=True, exist_ok=True)
        with override_settings(
            STUDYFLOW_READINESS_ENABLED=True,
            STUDYFLOW_CONSUMPTION_ENABLED=True,
            STUDYFLOW_AI_MODE="mock",
            ALLOWED_HOSTS=["127.0.0.1", "localhost"],
        ), scripted_throttling() as throttling:
            report["throttling"] = throttling
            server = make_server(
                "127.0.0.1", 0, get_wsgi_application(), handler_class=QuietHandler
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for _ in range(options["runs"]):
                    report["runs"].append(
                        ConsumptionDemo(f"http://127.0.0.1:{server.server_port}").run()
                    )
                report["passed"] = True
            except Exception as exc:
                report["error_code"] = type(exc).__name__
                raise
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
                options["output"].write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        self.stdout.write(f"Consumption HTTP demo passed ({len(report['runs'])} runs)")
