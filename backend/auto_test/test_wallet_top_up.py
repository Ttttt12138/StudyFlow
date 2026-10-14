"""Wallet top-up (POST demo/wallets/top-up/): simulated money into the student's own demo wallet."""
from decimal import Decimal
from uuid import uuid4

from django.test import override_settings
from rest_framework.test import APITestCase

from finance.workflow_models import DemoLedgerEntry, FundingSource

from .test_multicurrency import FX_SETTINGS, HOME, OPENING, MultiCurrencyHarness


@override_settings(**FX_SETTINGS)
class WalletTopUpTests(MultiCurrencyHarness, APITestCase):
    username = "top-up-student"

    def setUp(self):
        self.bootstrap()

    def balance(self, currency):
        rows = self.get("demo/wallets/balances").data["data"]["balances"]
        return next((Decimal(row["balance"]) for row in rows if row["currency"] == currency), Decimal(0))

    def test_home_top_up_credits_the_wallet_and_the_state(self):
        data = self.post("demo/wallets/top-up", {"currency": HOME, "amount": "5000.00"})
        self.assertEqual((data["currency"], data["amount"]), (HOME, "5000.00"))
        self.assertEqual(self.balance(HOME), OPENING + 5000)
        entry = DemoLedgerEntry.objects.get(owner=self.user, funding_source__kind="top_up")
        self.assertEqual(entry.amount, Decimal("5000.00"))
        events = self.state().snapshot["events"]
        self.assertTrue(any(e["id"] == "received:" + data["id"] and e["settled_sequence"] == entry.sequence for e in events))

    def test_foreign_top_up_opens_that_balance_without_touching_the_state(self):
        version = self.version()
        self.post("demo/wallets/top-up", {"currency": "USD", "amount": "120.50"})
        self.assertEqual(self.balance("USD"), Decimal("120.50"))
        self.assertEqual(self.version(), version)
        self.assertIn("USD", self.get("demo/wallets/balances").data["data"]["supported_currencies"])

    def test_same_key_tops_up_once(self):
        key = str(uuid4())
        self.post("demo/wallets/top-up", {"currency": HOME, "amount": "100.00"}, key=key)
        self.call("demo/wallets/top-up", {"currency": HOME, "amount": "100.00"}, key=key)
        self.assertEqual(FundingSource.objects.filter(owner=self.user, kind="top_up").count(), 1)
        self.assertEqual(self.balance(HOME), OPENING + 100)

    def test_amount_limits(self):
        self.reject("demo/wallets/top-up", {"currency": HOME, "amount": "0"}, "TOP_UP_AMOUNT_OUT_OF_RANGE")
        self.reject("demo/wallets/top-up", {"currency": HOME, "amount": "1000000.01"}, "TOP_UP_AMOUNT_OUT_OF_RANGE")
        self.reject("demo/wallets/top-up", {"currency": "JPY", "amount": "10.5"}, "")
        self.assertFalse(FundingSource.objects.filter(owner=self.user, kind="top_up").exists())

    def test_needs_an_initialized_wallet(self):
        self.reject("demo/wallets/top-up", {"currency": HOME, "amount": "10.00"}, "", user=self.other)
