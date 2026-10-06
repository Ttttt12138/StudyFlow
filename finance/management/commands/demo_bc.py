import json
from pathlib import Path
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient


class Demo:
    def __init__(self):
        run_id = uuid4().hex
        users = get_user_model().objects
        self.student = users.create_user(username="bc-student-" + run_id)
        self.operator = users.create_user(
            username="bc-operator-" + run_id, is_staff=True
        )
        self.tokens = {
            role: Token.objects.create(user=user).key
            for role, user in [("student", self.student), ("operator", self.operator)]
        }
        self.client = APIClient(HTTP_HOST="localhost")
        self.run_id = run_id

    def post(self, route, body, *, operator=False, key=None):
        self.client.credentials(
            HTTP_AUTHORIZATION="Token "
            + self.tokens["operator" if operator else "student"]
        )
        response = self.client.post(
            "/api/v2/" + route + "/",
            body,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key or uuid4().hex,
        )
        if response.status_code not in {200, 201}:
            raise CommandError(f"{route}: {response.status_code}: {response.data}")
        return response.data.get("data", response.data)

    def scenario(self):
        from finance.workflow_common import current

        return self.post(
            "scenarios",
            {
                "state_version": current(self.student).version,
                "kind": "expected",
                "end_date": "2027-10-01",
            },
        )

    def explain(self, application):
        scenario = self.scenario()
        return self.post(
            "applications/" + application["id"] + "/explain",
            {"scenario_id": scenario["id"]},
        )

    def prepare(self):
        self.post(
            "state",
            {
                "expected_version": 0,
                "snapshot": {
                    "currency": "THB",
                    "as_of": "2026-10-02",
                    "opening_balance": "0.00",
                    "reserve": "0.00",
                    "events": [],
                },
            },
        )
        self.post("demo/initialize", {"state_version": 1})
        quote = self.post(
            "loans",
            {
                "principal": "30600.00",
                "fees": "600.00",
                "annual_rate": "0",
                "months": 12,
                "first_due_date": "2026-11-01",
            },
        )
        application = self.post("applications", {"quote_id": quote["id"]})
        pending = self.post(
            "applications/" + application["id"] + "/action",
            {"expected_version": 1, "action": "submit"},
        )
        require(
            pending["status"] == "UNDER_REVIEW", "Missing inputs must require review"
        )
        return quote, pending

    def approve(self, quote, pending):
        months = [
            {
                "month": row["due_date"][:7],
                "income": "10000.00",
                "living_expenses": "4000.00",
                "existing_repayments": "1000.00",
            }
            for row in quote["result"]["repayments"]
        ]
        self.post("affordability-profile", {"expected_version": 0, "months": months})
        approved = self.post(
            "applications/" + pending["id"] + "/decision",
            {"expected_version": pending["version"], "reason": "Demo inputs supplied"},
            operator=True,
        )
        from finance.workflow_models import DemoWallet

        require(approved["status"] == "APPROVED", "Complete inputs should approve")
        require(
            DemoWallet.objects.get(owner=self.student).balance == 0,
            "Approval cannot create cash",
        )
        return approved

    def fund(self, approved):
        route = "applications/" + approved["id"] + "/disburse"
        body = {"expected_version": approved["version"]}
        funded = self.post(route, body, operator=True, key="disburse")
        require(
            self.post(route, body, operator=True, key="disburse") == funded,
            "Replay changed result",
        )
        require(
            funded["wallet"]["balance"] == "30000.00", "Net receipt differs from quote"
        )
        return funded

    def repay_all(self, funded):
        source = self.post(
            "funding-sources",
            {
                "economic_key": "demo-topup",
                "kind": "external_savings",
                "currency": "THB",
                "amount": "600.00",
                "available_on": "2026-10-02",
                "certainty": "confirmed",
            },
        )
        self.post("funding-sources/" + source["id"] + "/receive", {}, operator=True)
        account = funded["account"]
        for row in account["installments"]:
            self.post("demo/clock", {"date": row["due_on"]})
            settled = self.post(
                "loan-accounts/" + account["id"] + "/repay",
                {
                    "expected_version": account["version"],
                    "installment_number": row["number"],
                },
            )
            account = settled["account"]
        require(account["status"] == "CLOSED", "Loan did not close")
        require(settled["wallet"]["balance"] == "0.00", "Wallet does not reconcile")
        return settled

    def run(self):
        from finance.workflow_common import record
        from finance.workflow_models import DemoLedgerEntry

        quote, pending = self.prepare()
        missing = self.explain(pending)
        approved = self.approve(quote, pending)
        approved_explanation = self.explain(approved)
        funded = self.fund(approved)
        received = self.explain(funded["application"])
        require(
            received["result"]["candidates"][0]["validation"] == "INVALID",
            "C reallocates received funds",
        )
        settled = self.repay_all(funded)
        return {
            "run_id": self.run_id,
            "simulated": True,
            "model_mode": "mock",
            "quote": quote,
            "pending": pending,
            "approved": approved,
            "funded": funded,
            "settled": settled,
            "c_integration": {
                "missing": missing,
                "approved": approved_explanation,
                "received": received,
            },
            "ledger": [
                record(row)
                for row in DemoLedgerEntry.objects.filter(owner=self.student).order_by(
                    "sequence"
                )
            ],
        }


def require(condition, message):
    if not condition:
        raise CommandError(message)


class Command(BaseCommand):
    help = "Run the merged B/C mock flow through authenticated Django routes with fresh demo identities."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output", type=Path, default=Path("output/django-bc-demo.json")
        )
        parser.add_argument("--runs", type=int, choices=range(1, 4), default=1)

    def handle(self, *args, **options):
        reports = [Demo().run() for _ in range(options["runs"])]
        output = options["output"]
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self.stdout.write(f"{len(reports)} B/C runs passed; report: {output}")
