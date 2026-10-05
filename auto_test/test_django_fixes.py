from decimal import Decimal

from django.db import DatabaseError, transaction
from rest_framework.test import APITestCase

from finance.models import FinancialState
from finance.workflow_models import IdempotencyRecord, LoanSimulation

from .test_lending_merge import TERMS, LendingHarness


class DjangoFixTests(LendingHarness, APITestCase):
    def test_openapi_exposes_required_idempotency_header(self):
        self.client.force_authenticate(self.student)
        schema = self.client.get("/api/schema/?format=json").data
        operation = schema["paths"]["/api/v2/loans/"]["post"]
        headers = [
            parameter
            for parameter in operation.get("parameters", [])
            if parameter["name"] == "Idempotency-Key"
        ]
        self.assertEqual(len(headers), 1)
        self.assertEqual(headers[0]["in"], "header")
        self.assertTrue(headers[0]["required"])

    def scenario(self):
        version = FinancialState.objects.filter(owner=self.student).first().version
        return self.post(
            "scenarios",
            {"state_version": version, "kind": "expected", "end_date": "2027-11-01"},
        )

    def test_cancelled_loan_cannot_fund_budget(self):
        loan, _, path = self.prepare()
        self.post(path + "/action", {"action": "cancel", "expected_version": 2})
        source = self.post(
            "funding-sources",
            {
                "economic_key": "cancelled-loan",
                "kind": "loan",
                "loan_id": loan["id"],
                "currency": "THB",
                "amount": "30000.00",
                "available_on": "2026-10-10",
                "certainty": "estimated",
            },
        )
        scenario = self.scenario()
        self.post(
            "funding-plans",
            {
                "scenario_id": scenario["id"],
                "allocations": [{"source_id": source["id"], "amount": "30000.00"}],
            },
            code=400,
        )

    def test_scenario_cannot_rewrite_settled_repayment(self):
        loan, _, _, account = self.fund()
        self.post("demo/clock", {"date": "2026-11-01"})
        self.post(
            "loan-accounts/" + account["id"] + "/repay",
            {"expected_version": 1, "installment_number": 1},
        )
        version = FinancialState.objects.filter(owner=self.student).first().version
        self.post(
            "scenarios",
            {
                "state_version": version,
                "kind": "expected",
                "end_date": "2027-11-01",
                "overrides": [
                    {
                        "event_id": "repayment:" + loan["id"] + ":1",
                        "amount": "1.00",
                        "certainty": "confirmed",
                    }
                ],
            },
            code=400,
        )

    def test_computed_repayment_precision_is_validated_before_storage(self):
        self.post(
            "loans",
            {
                **TERMS,
                "principal": "99999999999999.99",
                "fees": "0",
                "annual_rate": "1",
                "months": 1,
            },
            code=400,
        )

    def test_c_explanation_uses_real_scenario_and_rejects_received_funds(self):
        _, app, _, _ = self.fund()
        scenario = self.scenario()
        exported = self.get("applications/" + app["id"] + "/c-context")
        explained = self.post(
            "applications/" + app["id"] + "/explain", {"scenario_id": scenario["id"]}
        )
        self.assertEqual(
            explained["result"]["loan_explanations"][0]["quote"], exported["quote"]
        )
        self.assertEqual(explained["mode"], "mock")
        self.assertFalse(explained["context"]["budget"]["complete"])
        self.assertEqual(
            Decimal(explained["context"]["budget"]["base"]["amount"]), Decimal("30600")
        )
        self.assertEqual(explained["result"]["candidates"][0]["validation"], "INVALID")

    def test_idempotency_key_cannot_cross_lending_operations(self):
        quote = self.post("loans", TERMS, key="shared")
        self.post("applications", {"quote_id": quote["id"]}, key="shared", code=400)

    def test_quotes_and_successful_requests_are_immutable(self):
        quote = self.post("loans", TERMS, key="immutable")
        with self.assertRaises(DatabaseError), transaction.atomic():
            LoanSimulation.objects.filter(pk=quote["id"]).update(result={})
        with self.assertRaises(DatabaseError), transaction.atomic():
            IdempotencyRecord.objects.filter(key="immutable").update(response={})
