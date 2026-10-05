"""Real loopback HTTP + PostgreSQL + explicit mock/live providers; synthetic identities only."""

import json
import threading
from copy import deepcopy
from pathlib import Path
from uuid import uuid4
from wsgiref.simple_server import WSGIRequestHandler, make_server

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.core.wsgi import get_wsgi_application
from django.test import override_settings
from rest_framework.authtoken.models import Token

from finance.readiness.jobs import run_one
from finance.readiness.models import ReadinessJob


class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):
        pass


class Demo:
    def __init__(self, base_url):
        self.run_id = uuid4().hex
        users = get_user_model().objects
        self.student = users.create_user(username="readiness-demo-" + self.run_id)
        self.operator = users.create_user(
            username="readiness-operator-" + self.run_id, is_staff=True
        )
        self.tokens = {
            role: Token.objects.create(user=user).key
            for role, user in [("student", self.student), ("operator", self.operator)]
        }
        self.http = httpx.Client(
            base_url=base_url + "/api/v2/", trust_env=False, timeout=30
        )

    def request(self, route, body=None, operator=False, key=None, **kwargs):
        headers = {
            "Authorization": "Token "
            + self.tokens["operator" if operator else "student"],
            "Idempotency-Key": key or uuid4().hex,
        }
        if body is None and not kwargs:
            response = self.http.get(route + "/", headers=headers)
        else:
            response = self.http.post(
                route + "/",
                headers=headers,
                **({"json": body} if body is not None else kwargs),
            )
        if response.status_code not in {200, 201, 202}:
            raise CommandError(
                f"{route}: HTTP {response.status_code}: {response.text[:1200]}"
            )
        return response.json().get("data", response.json())

    def context(self):
        data = self.request("readiness/state")
        return {k: data[k] for k in ("semester_id", "state_version", "budget_version")}

    def drain(self, job_id=None):
        for _ in range(200):
            if job_id:
                job = ReadinessJob.objects.get(pk=job_id)
                if job.status in {"DONE", "RETRY"}:
                    return self.request("readiness/checks/" + str(job_id))
            if not run_one(self.student):
                break
        if job_id:
            return self.request("readiness/checks/" + str(job_id))

    def draft(self, semester):
        draft = deepcopy(semester["draft"])
        for item in draft["costs"]:
            item.update(
                paid=False,
                conflict=False,
                source_refs=[],
                valid_until=None,
                synthetic=True,
            )
            if item["cost_id"] == "tuition":
                item.update(amount="175000.00", due_date="2026-08-10")
            else:
                item.update(
                    applicability="NOT_APPLICABLE",
                    applicability_reason="Synthetic integration fixture only",
                )
        return draft

    def prepare(self):
        semester = self.request(
            "readiness/semesters",
            {
                "room": "shared",
                "reserve": "15000.00",
                "opening_balance": "140000.00",
                "as_of": "2026-08-01",
            },
        )
        self.request("demo/initialize", {"state_version": semester["state_version"]})
        # Confirmed synthetic monthly income/expenses support the complete repayment horizon.
        state = self.request("state")
        for month in [9, 10, 11, 12]:
            state["snapshot"]["events"].extend(
                [
                    {
                        "id": f"income-{month}",
                        "label": "Synthetic confirmed support",
                        "kind": "income",
                        "amount": "10000.00",
                        "date": f"2026-{month:02d}-01",
                        "certainty": "confirmed",
                    },
                    {
                        "id": f"living-{month}",
                        "label": "Synthetic living",
                        "kind": "expense",
                        "amount": "4000.00",
                        "date": f"2026-{month:02d}-02",
                        "certainty": "confirmed",
                    },
                ]
            )
        self.request(
            "state",
            {"expected_version": state["version"], "snapshot": state["snapshot"]},
        )
        text = (
            "SYNTHETIC integration fixture; not a PSU invoice.\nSchool: Prince of Songkla University\n"
            "Campus: Phuket\nCountry: Thailand\nProgram: BBA International Business\n"
            "Student type: new international undergraduate\nStart date: 2026-08-10\nEnd date: 2026-12-15\n"
            "Tuition: THB 175000 per semester; year 2026; campus Phuket; unpaid; due 2026-08-10; invoice_id DEMO-175\n"
        )
        material = self.request(
            "readiness/imports",
            data={**self.context(), "kind": "text"},
            files={"file": ("synthetic-offer.txt", text.encode(), "text/plain")},
        )
        self.drain()
        extracted = self.request("readiness/imports/" + material["id"])
        require(extracted["status"] == "NEEDS_REVIEW", "Material extraction failed")
        require(
            bool(extracted["result"].get("draft", {}).get("costs")),
            "No source-supported costs extracted",
        )
        self.request(
            "readiness/imports/" + material["id"] + "/confirm",
            {
                **self.context(),
                "draft": self.draft(semester),
                "issuer": "SYNTHETIC PSU integration fixture",
                "selected_cost_ids": ["tuition"],
                "conflict_resolutions": {
                    "tuition": "Explicit synthetic fixture; not official tuition"
                },
            },
        )
        return extracted

    def financing(self):
        self.request(
            "funding-sources",
            {
                "economic_key": "family",
                "kind": "family",
                "currency": "THB",
                "amount": "20000.00",
                "available_on": "2026-08-01",
                "certainty": "confirmed",
            },
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
        app = self.request("applications", {"quote_id": quote["id"]})
        self.request(
            "funding-sources",
            {
                "economic_key": "borrowing",
                "kind": "loan",
                "currency": "THB",
                "amount": "30000.00",
                "available_on": "2026-08-01",
                "certainty": "estimated",
                "loan_id": quote["id"],
            },
        )
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
        self.request("affordability-profile", {"expected_version": 0, "months": months})
        return quote, app

    def run(self):
        try:
            extraction = self.prepare()
            _quote, app = self.financing()
            budget = self.request("readiness/budgets", self.context())
            require(budget["result"]["complete"], "Synthetic budget must be complete")
            check = self.request("readiness/checks", self.context())
            checked = self.drain(check["id"])
            require(checked["status"] == "DONE", "Readiness model check did not finish")
            result = checked["result"]
            require(result.get("completeness", {}).get("complete"), "C completeness must agree with B")
            candidates = (result.get("funding") or {}).get("candidates", [])
            require(
                any(c["validation"] in {"VALID", "CONDITIONAL"} for c in candidates),
                "No B-validated funding candidate",
            )
            approved = self.request(
                "applications/" + app["id"] + "/action",
                {"expected_version": app["version"], "action": "submit"},
            )
            require(
                approved["status"] == "APPROVED",
                "Complete synthetic repayment profile did not approve",
            )
            body = {"expected_version": approved["version"]}
            disbursed = self.request(
                "applications/" + app["id"] + "/disburse",
                body,
                operator=True,
                key="disburse",
            )
            replay = self.request(
                "applications/" + app["id"] + "/disburse",
                body,
                operator=True,
                key="disburse",
            )
            require(disbursed == replay, "Disbursement replay differs")
            require(
                disbursed["wallet"]["balance"] == "170000.00", "Loan receipt not exact"
            )
            self.request("demo/clock", {"date": "2026-09-05"})
            account = disbursed["account"]
            repayment = self.request(
                "loan-accounts/" + account["id"] + "/repay",
                {"expected_version": account["version"], "installment_number": 1},
            )
            forecast = self.request(
                "readiness/forecasts", {**self.context(), "horizon": 90}
            )
            latest_job = ReadinessJob.objects.filter(
                owner=self.student, kind="check"
            ).latest("created_at")
            after_repayment = self.drain(latest_job.id)
            require(
                after_repayment["status"] == "DONE",
                "Automatic post-repayment check failed",
            )
            calls = (
                extraction["result"].get("calls", [])
                + result.get("routing", {}).get("calls", [])
                if result.get("routing")
                else extraction["result"].get("calls", [])
            )
            calls += (result.get("funding") or {}).get("calls", [])
            return {
                "run_id": self.run_id,
                "transport": "real_loopback_http",
                "database": "postgresql",
                "synthetic": True,
                "mode": settings.STUDYFLOW_AI_MODE,
                "calls": calls,
                "extraction": extraction,
                "budget": budget,
                "check": checked,
                "disbursement": disbursed,
                "repayment": repayment,
                "forecast": forecast,
                "after_repayment_check": after_repayment,
            }
        finally:
            self.http.close()


def require(condition, message):
    if not condition:
        raise CommandError(message)


class Command(BaseCommand):
    help = "Run authenticated readiness flows over a real local HTTP server; no actual money moves."

    def add_arguments(self, parser):
        parser.add_argument("--mode", choices=["mock", "live"], default="mock")
        parser.add_argument("--runs", type=int, default=3)
        parser.add_argument("--env-file", type=Path)
        parser.add_argument(
            "--output", type=Path, default=Path("output/readiness-http-demo.json")
        )

    def handle(self, *args, **options):
        if options["env_file"]:
            from studyflow_ai.config import load_env_file

            load_env_file(options["env_file"])
        report = {"mode": options["mode"], "passed": False, "runs": []}
        options["output"].parent.mkdir(parents=True, exist_ok=True)
        with override_settings(
            STUDYFLOW_READINESS_ENABLED=True,
            STUDYFLOW_AI_MODE=options["mode"],
            ALLOWED_HOSTS=["127.0.0.1", "localhost"],
        ):
            server = make_server(
                "127.0.0.1", 0, get_wsgi_application(), handler_class=QuietHandler
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for _ in range(options["runs"]):
                    report["runs"].append(
                        Demo(f"http://127.0.0.1:{server.server_port}").run()
                    )
                    self.stdout.write(
                        f"HTTP readiness run {len(report['runs'])} passed"
                    )
                report["passed"] = True
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
                options["output"].write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
