from datetime import date
from decimal import Decimal
from unittest import TestCase

from studyflow_ai.bank_data import CsvTransactionAdapter, classify_transaction
from studyflow_ai.models import Transaction


class ConsumptionRulesTests(TestCase):
    def test_versioned_fixture_hash_and_recurring_expectations(self):
        import hashlib
        import json
        from pathlib import Path

        from studyflow_ai.recurring import detect_recurring

        folder = Path(__file__).resolve().parents[1] / "examples" / "consumption" / "v1"
        manifest = json.loads((folder / "manifest.json").read_text())
        for name, expected in manifest["files"].items():
            self.assertEqual(
                hashlib.sha256((folder / name).read_bytes()).hexdigest(),
                expected["sha256"],
            )
        rows, issues = CsvTransactionAdapter().parse(
            (folder / "history.csv").read_bytes()
        )
        self.assertFalse(issues)
        patterns = detect_recurring(rows, date(2026, 10, 1))
        self.assertEqual(
            sorted(p.category for p in patterns),
            sorted(manifest["expected"]["recurring_categories"]),
        )

    def test_csv_bom_and_invalid_currency(self):
        header = "\ufeffaccount_id,date,amount,currency,counterparty,description\n"
        rows, issues = CsvTransactionAdapter().parse(
            (
                header
                + "a,2026-09-01,-99.00,THB,Cafe,Lunch\n"
                + "a,2026-09-02,-12.00,USD,Cafe,Lunch\n"
            ).encode()
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(issues[0]["code"], "INVALID_CSV_ROW")
        self.assertEqual(classify_transaction(rows[0])["category"], "Food")

    def test_transfer_and_refund_are_not_income_or_food(self):
        for description, amount, expected in [
            ("Internal transfer", "-100", "Transfer"),
            ("Lunch refund", "40", "Refund"),
        ]:
            tx = Transaction(
                account_id="a",
                date=date(2026, 9, 1),
                amount=Decimal(amount),
                counterparty="Cafe",
                description=description,
            )
            self.assertEqual(classify_transaction(tx)["category"], expected)

    def test_ambiguous_expense_stays_other(self):
        tx = Transaction(
            account_id="a",
            date=date(2026, 9, 1),
            amount="-10",
            counterparty="Unknown",
            description="Purchase",
        )
        result = classify_transaction(tx)
        self.assertEqual(result["category"], "Other")
        self.assertLess(result["confidence"], 0.5)
