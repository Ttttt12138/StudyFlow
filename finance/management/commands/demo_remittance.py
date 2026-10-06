"""Synthetic end-to-end multi-currency remittance flow over real HTTP (docs/remittance.md)."""

import json
import threading
from pathlib import Path
from wsgiref.simple_server import make_server

from django.core.management.base import BaseCommand
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from finance.corridors import ensure_default_corridors
from finance.management.commands.demo_readiness import Demo, QuietHandler, require
from finance.policy_defaults import ensure_default_limits
from finance.policy_flow import scripted_throttling
from finance.workflow_models import Corridor

SNAPSHOT = {"currency": "THB", "as_of": "2026-10-02", "opening_balance": "80000.00",
            "reserve": "15000.00", "events": []}


class RemittanceDemo(Demo):
    def setup_wallet(self, cny="40000.00"):
        self.request("state", {"expected_version": 0, "snapshot": SNAPSHOT})
        self.request("demo/initialize", {"state_version": 1})
        source = self.request("funding-sources", {
            "economic_key": "family-cny-" + self.run_id, "kind": "external_savings", "currency": "CNY",
            "amount": cny, "available_on": SNAPSHOT["as_of"], "certainty": "confirmed"})
        self.request("funding-sources/" + source["id"] + "/receive",
                     {"hold_in_source_currency": True}, operator=True)

    def balance(self, currency):
        rows = self.request("demo/wallets/balances")["balances"]
        return next((r["balance"] for r in rows if r["currency"] == currency), "0.00")

    def quotes(self, amount):
        ids = [str(c.id) for c in Corridor.objects.filter(source_currency="CNY", target_currency="THB")]
        return [self.request("fx-quotes/live", {"corridor_id": cid, "send_amount": amount}) for cid in ids]

    def order(self, quote_id, **extra):
        return self.request("remittance-orders", {"quote_id": quote_id, "recipient": "SELF",
                                                  "purpose": "living", **extra})

    def step(self, order, route, body=None, operator=False):
        return self.request(f"remittance-orders/{order['id']}/{route}",
                            {"expected_version": order["version"], **(body or {})}, operator=operator)

    def run(self):
        self.setup_wallet()
        rate = self.http.get("fx-rates/", params={"base": "CNY", "quote": "THB"},
                             headers={"Authorization": "Token " + self.tokens["student"]}).json()["data"]
        quotes = self.quotes("5000.00")
        comparison = self.request("remittance-comparisons", {
            "quote_ids": [q["id"] for q in quotes], "source_currency": "CNY", "amount": "5000.00",
            "required_amount": "20000.00", "send_on": SNAPSHOT["as_of"], "deadline": "2026-10-09"})
        chosen = comparison["recommended_quote_id"]
        require(chosen, "No feasible route recommended")
        order = self.order(chosen, deadline="2026-10-09")
        order = self.step(order, "submit")
        require(order["status"] == "SUBMITTED" and self.balance("CNY") == "35000.00", "Submit did not debit CNY")
        order = self.step(order, "adapter-event", {"outcome": "dispatched"}, operator=True)
        order = self.step(order, "adapter-event", {"outcome": "delivered"}, operator=True)
        order = self.step(order, "reconcile")
        require(order["status"] == "RECONCILED" and order["on_time"], "Delivery not reconciled on time")
        require([h["to"] for h in order["history"]] == ["CREATED", "SUBMITTED", "IN_TRANSIT", "DELIVERED",
                                                         "RECONCILED"], "Unexpected history")
        # A failed transfer is refunded in full.
        failing = self.order(self.quotes("1000.00")[0]["id"])
        failing = self.step(failing, "submit")
        failing = self.step(failing, "adapter-event", {"outcome": "failed", "note": "Synthetic bank reject"},
                            operator=True)
        require(failing["status"] == "REFUNDED" and self.balance("CNY") == "35000.00", "Refund missing")
        # Over the 10,000 CNY per-transaction limit: T3, approved by a second operator.
        large = self.order(self.quotes("12000.00")[0]["id"])
        large = self.step(large, "submit")
        require(large["status"] == "SUBMITTED", "Approved T3 order not submitted")
        tiers = [entry["tier"] for entry in self.policy.log]
        require(tiers.count("T3") == 1, "Expected exactly one T3 approval")
        credit = self.request("credit/profile")
        require(credit["on_time"] == 1, "Delivered order missing from on-time record")
        return {
            "run_id": self.run_id, "reference_rate": {k: rate[k] for k in ("rate", "rate_date", "source")},
            "routes": [{k: r[k] for k in ("route_name", "net_received", "arrival_latest", "feasible")}
                       for r in comparison["routes"]],
            "order": {k: order[k] for k in ("send_amount", "sender_fee", "fx_margin_cost", "total_cost",
                                            "receive_amount", "status", "on_time")},
            "refund": {"status": failing["status"], "failure_reason": failing["failure_reason"]},
            "large_order": {"status": large["status"], "send_amount": large["send_amount"]},
            "balances": self.request("demo/wallets/balances")["balances"],
            "credit": {k: credit[k] for k in ("level", "on_time", "limit_multiplier")},
            "policy": self.policy.log, "is_simulated": True,
        }


def serve(demo_class, options, label):
    require(1 <= options["runs"] <= 10, "Runs must be 1-10")
    ensure_default_corridors()
    ensure_default_limits()
    report = {"passed": False, "runs": []}
    options["output"].parent.mkdir(parents=True, exist_ok=True)
    with override_settings(STUDYFLOW_READINESS_ENABLED=True, STUDYFLOW_AI_MODE="mock",
                           STUDYFLOW_FX_LIVE=False, ALLOWED_HOSTS=["127.0.0.1", "localhost"]), \
            scripted_throttling() as throttling:
        report["throttling"] = throttling
        server = make_server("127.0.0.1", 0, get_wsgi_application(), handler_class=QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for _ in range(options["runs"]):
                report["runs"].append(demo_class(f"http://127.0.0.1:{server.server_port}").run())
            report["passed"] = True
        except Exception as exc:
            report["error_code"] = type(exc).__name__
            raise
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            options["output"].write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"{label} passed ({len(report['runs'])} runs)"


class Command(BaseCommand):
    help = "Run the simulated remittance flow (quotes, comparison, order lifecycle, refund, T3) over HTTP."

    def add_arguments(self, parser):
        parser.add_argument("--runs", type=int, default=3)
        parser.add_argument("--output", type=Path, default=Path("output/remittance-http-demo.json"))

    def handle(self, *args, **options):
        self.stdout.write(serve(RemittanceDemo, options, "Remittance HTTP demo"))
