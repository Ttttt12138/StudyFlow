"""Contract tests for docs/multi-currency.md and docs/fx-rates.md.

These tests exercise the real HTTP routes under /api/v2/ and only touch the ORM to
arrange edge cases (expired quotes, disabled corridors, old rate snapshots) or to
verify persisted state. Expected prices are computed from the documented rules
(fixture mid-rates, corridor margin/fees, rounding modes), never from implementation
output. Feature models are resolved lazily so the module always imports.
"""
import random
from copy import deepcopy
from datetime import timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from unittest.mock import patch
from uuid import uuid4

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.db.models import Sum
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from finance.models import AuditEvent, FinancialState
from finance.policy_defaults import ensure_default_limits
from finance.policy_flow import client_flow, step_up_header
from finance.tests import BASE
from finance.workflow_models import DemoLedgerEntry, DemoWallet, FundingSource, FXQuote

HOME = "THB"
OPENING = Decimal(BASE["opening_balance"])
RESERVE = Decimal(BASE["reserve"])
CONVERSION_FIELDS = {
    "id", "quote_id", "source_currency", "source_amount", "target_currency",
    "target_amount", "rate", "sender_fee", "receiver_fee", "effective_on",
    "debit_sequence", "credit_sequence", "is_simulated",
}
# docs/fx-rates.md fixture mid-rates, THB per unit; cross rates go through THB.
FIXTURE = {"THB": Decimal("1"), "USD": Decimal("33.00"), "EUR": Decimal("36.50"),
           "CNY": Decimal("4.60"), "GBP": Decimal("42.00"), "JPY": Decimal("0.22")}
SEEDED_PAIRS = [("CNY", HOME), ("USD", HOME), ("EUR", HOME), (HOME, "CNY")]
TIERS = ["economy", "express", "standard"]
TEN_DP = Decimal("0.0000000001")
FX_SETTINGS = {"STUDYFLOW_FX_LIVE": False, "STUDYFLOW_FX_CACHE_SECONDS": 900}
PASSWORD = "mc-student-pass-1"


def model(name):
    return apps.get_model("finance", name)


def D(value):
    return Decimal(str(value))


def unit(currency):
    return Decimal("1") if currency == "JPY" else Decimal("0.01")


def fixture_mid(base, quote):
    return (FIXTURE[base] / FIXTURE[quote]).quantize(TEN_DP)


def price(corridor, amount):
    """Live quote pricing per docs/fx-rates.md, from a corridor row and the fixture mid."""
    source, target = corridor["source_currency"], corridor["target_currency"]
    amount = D(amount)
    mid = fixture_mid(source, target)
    rate = (mid * (1 - D(corridor["fx_margin_bps"]) / 10000)).quantize(TEN_DP, rounding=ROUND_DOWN)
    fee = (D(corridor["fee_fixed"]) + amount * D(corridor["fee_percent"])).quantize(
        unit(source), rounding=ROUND_HALF_UP)
    received = ((amount - fee) * rate).quantize(unit(target), rounding=ROUND_HALF_UP)
    return {"mid": mid, "rate": rate, "sender_fee": fee, "target": received}


def items(payload):
    """Accept a bare list, {"data": [...]}, {"results": [...]} or nested variants."""
    if isinstance(payload, list):
        return payload
    for key in ("results", "data"):
        if isinstance(payload, dict) and key in payload:
            return items(payload[key])
    raise AssertionError("Unexpected list payload: %r" % (payload,))


class MultiCurrencyHarness:
    """Shared fixtures; mixed into APITestCase and TransactionTestCase classes."""

    username = "mc-student"

    def bootstrap(self):
        from finance.corridors import ensure_default_corridors
        ensure_default_corridors()
        ensure_default_limits()
        self._corridors = {}
        users = get_user_model().objects
        self.user = users.create_user(username=self.username, password=PASSWORD)
        self.operator = users.create_user(username=self.username + "-operator", is_staff=True)
        # Approves T3 requests; the operator verifies beneficiaries and so may not.
        self.approver = users.create_user(username=self.username + "-approver", is_staff=True)
        self.other = users.create_user(username=self.username + "-other", password=PASSWORD)
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/api/v2/state/", {"expected_version": 0, "snapshot": deepcopy(BASE)}, format="json"
        )
        self.assertEqual(response.status_code, 201, str(response.data))
        self.post("demo/initialize", {"state_version": 1})

    # -- HTTP helpers -------------------------------------------------------
    def call(self, path, data=None, operator=False, key=None, user=None):
        actor = user or (self.operator if operator else self.user)
        # T2 routes need the documented step-up (and approval for T3) — performed via the API.
        headers = {} if actor.is_staff else step_up_header(
            client_flow(actor, PASSWORD, self.approver), path, data)
        self.client.force_authenticate(actor)
        try:
            return self.client.post(
                "/api/v2/" + path.strip("/") + "/", data or {}, format="json",
                HTTP_IDEMPOTENCY_KEY=key or str(uuid4()), **headers,
            )
        finally:
            self.client.force_authenticate(self.user)

    def post(self, path, data=None, operator=False, code=201, key=None, user=None):
        response = self.call(path, data, operator=operator, key=key, user=user)
        self.assertEqual(response.status_code, code, str(response.data))
        return response.data.get("data", response.data)

    def reject(self, path, data, error, operator=False, status=400, key=None, user=None):
        response = self.call(path, data, operator=operator, key=key, user=user)
        self.assertEqual(response.status_code, status, str(response.data))
        if error:
            self.assertIn(error, str(response.data))
        return response

    def get(self, path, params=None, user=None):
        self.client.force_authenticate(user or self.user)
        try:
            return self.client.get("/api/v2/" + path.strip("/") + "/", params or {})
        finally:
            self.client.force_authenticate(self.user)

    # -- domain helpers -----------------------------------------------------
    def version(self, owner=None):
        return FinancialState.objects.filter(owner=owner or self.user).first().version

    def state(self, owner=None):
        return FinancialState.objects.filter(owner=owner or self.user).first()

    def quote_body(self, source, target=HOME, rate="4.8", sender_fee="0", receiver_fee="0", **extra):
        body = {
            "source_currency": source, "target_currency": target, "rate": rate,
            "sender_fee": sender_fee, "receiver_fee": receiver_fee, "settlement_days": 0,
            "expires_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        }
        body.update(extra)
        return body

    def quote(self, source, target=HOME, rate="4.8", sender_fee="0", receiver_fee="0", user=None, **extra):
        """Manual (student-priced) quote: estimates and operator receipts only."""
        return self.post("fx-quotes", self.quote_body(source, target, rate, sender_fee, receiver_fee, **extra),
                         user=user)

    def corridor(self, source, target, tier="economy"):
        key = (source, target, tier)
        if key not in self._corridors:
            response = self.get("corridors", {"source_currency": source, "target_currency": target})
            self.assertEqual(response.status_code, 200, str(response.data))
            rows = [r for r in items(response.data) if r["tier"] == tier]
            self.assertEqual(len(rows), 1, (key, response.data))
            self._corridors[key] = rows[0]
        return self._corridors[key]

    def live(self, source, target, amount, tier="economy", code=201, user=None):
        """Server-priced corridor quote (POST fx-quotes/live/)."""
        corridor = self.corridor(source, target, tier)
        return self.post("fx-quotes/live", {"corridor_id": str(corridor["id"]), "send_amount": amount},
                         code=code, user=user)

    def source(self, currency, amount, kind="external_savings", **extra):
        body = {"economic_key": str(uuid4()), "kind": kind, "currency": currency, "amount": amount,
                "available_on": BASE["as_of"], "certainty": "confirmed", "already_in_opening": False}
        body.update(extra)
        return self.post("funding-sources", body)

    def hold(self, currency, amount):
        source = self.source(currency, amount)
        self.post("funding-sources/" + source["id"] + "/receive",
                  {"hold_in_source_currency": True}, operator=True)
        return source

    def receive_home(self, amount):
        source = self.source(HOME, amount)
        self.post("funding-sources/" + source["id"] + "/receive", {}, operator=True)
        return source

    def convert_body(self, quote_id, amount, version=None):
        return {"quote_id": quote_id, "source_amount": amount,
                "state_version": self.version() if version is None else version}

    def convert(self, quote_id, amount, version=None, key=None, code=201):
        return self.post("conversions", self.convert_body(quote_id, amount, version), key=key, code=code)

    def convert_live(self, source, target, amount, tier="economy"):
        quote = self.live(source, target, amount, tier)
        data = self.convert(quote["id"], amount)
        self.assertEqual(D(data["target_amount"]), price(self.corridor(source, target, tier), amount)["target"])
        return data

    def balances(self, user=None):
        response = self.get("demo/wallets/balances", user=user)
        self.assertEqual(response.status_code, 200, str(response.data))
        return response.data["data"]

    def balance_row(self, currency, user=None):
        rows = [row for row in self.balances(user)["balances"] if row["currency"] == currency]
        return rows[0] if rows else None

    def foreign(self, currency, owner=None):
        row = model("WalletBalance").objects.filter(owner=owner or self.user, currency=currency).first()
        return row.balance if row else Decimal("0")

    def home(self, owner=None):
        return DemoWallet.objects.get(owner=owner or self.user).balance

    def footprint(self):
        owner = self.user
        return {
            "ledger": list(DemoLedgerEntry.objects.filter(owner=owner).order_by("sequence")
                           .values_list("sequence", "currency", "amount")),
            "home": self.home(),
            "foreign": sorted(model("WalletBalance").objects.filter(owner=owner)
                              .values_list("currency", "balance")),
            "conversions": model("CurrencyConversion").objects.count(),
            "consumed": sorted(str(pk) for pk in FXQuote.objects.filter(
                owner=owner, consumed_at__isnull=False).values_list("pk", flat=True)),
            "version": self.version(),
        }

    def assert_invariant(self, owner=None, check_api=True):
        """Invariant 1: per currency, sum(ledger) == balance (home minus opening); balances >= 0."""
        owner = owner or self.user
        wallet = DemoWallet.objects.get(owner=owner)
        opening = D(wallet.initial_state.snapshot["opening_balance"])
        sums = {row["currency"]: row["total"] for row in DemoLedgerEntry.objects.filter(owner=owner)
                .values("currency").annotate(total=Sum("amount"))}
        self.assertEqual(sums.pop(HOME, Decimal("0")), wallet.balance - opening)
        self.assertGreaterEqual(wallet.balance, 0)
        rows = {row.currency: row.balance for row in model("WalletBalance").objects.filter(owner=owner)}
        self.assertNotIn(HOME, rows, "Home currency must never be written to WalletBalance")
        for currency in set(sums) | set(rows):
            self.assertEqual(sums.get(currency, Decimal("0")), rows.get(currency, Decimal("0")), currency)
            self.assertGreaterEqual(rows.get(currency, Decimal("0")), 0, currency)
        sequences = list(DemoLedgerEntry.objects.filter(owner=owner).values_list("sequence", flat=True))
        self.assertEqual(len(sequences), len(set(sequences)))
        for conversion in model("CurrencyConversion").objects.filter(
                pk__in=DemoLedgerEntry.objects.filter(owner=owner, conversion__isnull=False)
                .values("conversion")):
            legs = list(DemoLedgerEntry.objects.filter(conversion=conversion).order_by("amount"))
            self.assertEqual(len(legs), 2)
            self.assertLess(legs[0].amount, 0)
            self.assertGreater(legs[1].amount, 0)
            self.assertNotEqual(legs[0].currency, legs[1].currency)
        if check_api:
            data = self.balances(owner)
            listed = {row["currency"]: row for row in data["balances"]}
            self.assertEqual(D(listed[HOME]["balance"]), wallet.balance)
            self.assertEqual(set(listed) - {HOME}, set(rows))
            for currency, balance in rows.items():
                self.assertEqual(D(listed[currency]["balance"]), balance)

    def pending_payment(self, event_id="rent", submit=True):
        """Create, authorize and (optionally) submit a payment for a BASE expense."""
        beneficiary = self.post("beneficiaries", {"name": "Demo university", "destination_label": "MOCK"})
        self.post("beneficiaries/" + beneficiary["id"] + "/verify", {"verified": True}, operator=True)
        state = self.state()
        snapshot = deepcopy(state.snapshot)
        for event in snapshot["events"]:
            if event["id"] in {"rent", "tuition"}:
                event["beneficiary_id"] = beneficiary["id"]
        response = self.client.post("/api/v2/state/", {"expected_version": state.version,
                                                       "snapshot": snapshot}, format="json")
        self.assertEqual(response.status_code, 201, str(response.data))
        version = self.version()
        scenario = self.post("scenarios", {"state_version": version, "kind": "expected",
                                           "end_date": "2026-10-31"})
        plan = self.post("funding-plans", {"scenario_id": scenario["id"], "allocations": []})
        payment = self.post("payments", {"plan_id": plan["id"], "beneficiary_id": beneficiary["id"],
                                         "event_id": event_id})
        self.post("payments/" + payment["id"] + "/authorize", {"state_version": version})
        if submit:
            self.post("payments/" + payment["id"] + "/submit")
        return payment

    def settle(self, payment):
        return self.post("payments/" + payment["id"] + "/adapter-event", {"outcome": "settled"}, operator=True)


@override_settings(**FX_SETTINGS)
class MultiCurrencyApiTests(MultiCurrencyHarness, APITestCase):
    def setUp(self):
        self.bootstrap()

    # ---------------------------------------------------------------- balances
    def test_balances_shape_home_only_after_initialize(self):
        data = self.balances()
        self.assertEqual(data["home_currency"], HOME)
        self.assertIs(data["is_simulated"], True)
        self.assertEqual(len(data["balances"]), 1)
        row = data["balances"][0]
        self.assertTrue({"currency", "balance", "available_balance", "is_home"} <= set(row), row)
        self.assertEqual(row["currency"], HOME)
        self.assertIs(row["is_home"], True)
        self.assertEqual(D(row["balance"]), OPENING)
        self.assertEqual(D(row["available_balance"]), OPENING)

    def test_balances_requires_initialized_wallet(self):
        response = self.get("demo/wallets/balances", user=self.other)
        self.assertEqual(response.status_code, 400, str(response.data))
        self.client.force_authenticate(self.other)
        state = self.client.post("/api/v2/state/", {"expected_version": 0, "snapshot": deepcopy(BASE)},
                                 format="json")
        self.assertEqual(state.status_code, 201)
        response = self.get("demo/wallets/balances", user=self.other)
        self.assertEqual(response.status_code, 400, str(response.data))

    def test_foreign_balance_listed_after_hold_receive(self):
        self.hold("CNY", "1000.00")
        data = self.balances()
        listed = {row["currency"]: row for row in data["balances"]}
        self.assertEqual(set(listed), {HOME, "CNY"})
        self.assertIs(listed[HOME]["is_home"], True)
        self.assertIs(listed["CNY"]["is_home"], False)
        self.assertEqual(D(listed["CNY"]["balance"]), Decimal("1000.00"))
        self.assertEqual(D(listed["CNY"]["available_balance"]), Decimal("1000.00"))
        self.assertEqual(D(listed[HOME]["balance"]), OPENING)

    def test_home_available_balance_excludes_pending_payments(self):
        self.receive_home("9000.00")
        self.pending_payment("rent")
        row = self.balance_row(HOME)
        self.assertEqual(D(row["balance"]), Decimal("89000.00"))
        self.assertEqual(D(row["available_balance"]), Decimal("80000.00"))

    def test_balance_valuation_is_null_without_snapshot_and_never_fetches(self):
        self.hold("CNY", "1000.00")
        snapshots = model("FxRateSnapshot").objects.count()
        row = self.balance_row("CNY")
        self.assertIn("indicative_home_value", row)
        self.assertIn("valuation", row)
        self.assertIsNone(row["indicative_home_value"])
        self.assertIsNone(row["valuation"])
        self.assertEqual(model("FxRateSnapshot").objects.count(), snapshots)

    def test_balance_valuation_uses_saved_snapshot(self):
        self.hold("CNY", "1000.00")
        self.assertEqual(self.get("fx-rates", {"base": "CNY", "quote": HOME}).status_code, 200)
        snapshots = model("FxRateSnapshot").objects.count()
        row = self.balance_row("CNY")
        self.assertEqual(D(row["indicative_home_value"]), Decimal("4600.00"))
        self.assertEqual(D(row["valuation"]["rate"]), FIXTURE["CNY"])
        self.assertEqual(row["valuation"]["source"], "fixture")
        self.assertIn("rate_date", row["valuation"])
        self.assertIs(row["valuation"]["stale"], False)
        self.assertEqual(model("FxRateSnapshot").objects.count(), snapshots)

    # -------------------------------------------------------- hold receive
    def test_hold_in_source_currency_credits_wallet_balance_without_state_event(self):
        source = self.source("CNY", "1000.00")
        before_version = self.version()
        self.post("funding-sources/" + source["id"] + "/receive", {"hold_in_source_currency": True},
                  operator=True)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertEqual(self.home(), OPENING)
        self.assertEqual(self.version(), before_version)
        self.assertFalse(any(e["id"].endswith(source["id"]) for e in self.state().snapshot["events"]))
        entry = DemoLedgerEntry.objects.get(owner=self.user, funding_source_id=source["id"])
        self.assertEqual(entry.currency, "CNY")
        self.assertEqual(entry.amount, Decimal("1000.00"))
        self.assertTrue(FundingSource.objects.get(pk=source["id"]).received)
        self.assertFalse(model("WalletBalance").objects.filter(currency=HOME).exists())
        self.assert_invariant()

    def test_hold_requires_foreign_currency(self):
        source = self.source(HOME, "500.00")
        before = self.footprint()
        self.reject("funding-sources/" + source["id"] + "/receive", {"hold_in_source_currency": True},
                    "HOLD_REQUIRES_FOREIGN_CURRENCY", operator=True)
        self.assertEqual(self.footprint(), before)
        self.assertFalse(FundingSource.objects.get(pk=source["id"]).received)

    def test_hold_rejects_fx_quote(self):
        source = self.source("CNY", "500.00")
        quote = self.quote("CNY")
        before = self.footprint()
        self.reject("funding-sources/" + source["id"] + "/receive",
                    {"hold_in_source_currency": True, "fx_quote_id": quote["id"]},
                    "HOLD_WITHOUT_QUOTE", operator=True)
        self.assertEqual(self.footprint(), before)
        self.assertFalse(FundingSource.objects.get(pk=source["id"]).received)
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)

    # ------------------------------------------------- receive consumes quote
    def test_receive_with_manual_quote_converts_and_consumes_quote(self):
        source = self.source("CNY", "100.00")
        quote = self.quote("CNY", rate="5")
        self.post("funding-sources/" + source["id"] + "/receive", {"fx_quote_id": quote["id"]}, operator=True)
        self.assertEqual(self.home(), OPENING + Decimal("500.00"))
        self.assertEqual(self.foreign("CNY"), Decimal("0"))
        entry = DemoLedgerEntry.objects.get(owner=self.user, funding_source_id=source["id"])
        self.assertEqual(entry.currency, HOME)
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        second = self.source("CNY", "100.00")
        before = self.footprint()
        self.reject("funding-sources/" + second["id"] + "/receive", {"fx_quote_id": quote["id"]},
                    "QUOTE_CONSUMED", operator=True)
        self.assertEqual(self.footprint(), before)
        self.assertFalse(FundingSource.objects.get(pk=second["id"]).received)
        self.assert_invariant()

    def test_live_quote_used_by_receive_cannot_then_convert(self):
        self.hold("CNY", "5000.00")
        quote = self.live("CNY", HOME, "1000.00", tier="express")
        # Settlement delay comes from the corridor, so make the source already available.
        source = self.source("CNY", "1000.00", available_on="2026-09-01")
        self.post("funding-sources/" + source["id"] + "/receive", {"fx_quote_id": quote["id"]}, operator=True)
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), "QUOTE_CONSUMED")
        self.assertEqual(self.footprint(), before)

    def test_converted_quote_cannot_then_fund_receive(self):
        self.hold("CNY", "5000.00")
        quote = self.live("CNY", HOME, "1000.00", tier="express")
        self.convert(quote["id"], "1000.00")
        source = self.source("CNY", "1000.00", available_on="2026-09-01")
        before = self.footprint()
        self.reject("funding-sources/" + source["id"] + "/receive", {"fx_quote_id": quote["id"]},
                    "QUOTE_CONSUMED", operator=True)
        self.assertEqual(self.footprint(), before)
        self.assertFalse(FundingSource.objects.get(pk=source["id"]).received)

    # ------------------------------------------------------- manual fx quotes
    def test_fx_quote_target_defaults_to_home_and_accepts_foreign_target(self):
        body = self.quote_body("CNY")
        body.pop("target_currency")
        self.assertEqual(self.post("fx-quotes", body)["target_currency"], HOME)
        self.assertEqual(self.quote(HOME, "CNY", rate="0.2")["target_currency"], "CNY")
        self.assertEqual(self.quote("CNY", "USD", rate="0.14")["target_currency"], "USD")

    def test_fx_quote_same_currency_rejected(self):
        self.reject("fx-quotes", self.quote_body("CNY", "CNY", rate="1"), "SAME_CURRENCY_QUOTE")
        body = self.quote_body(HOME, rate="1")
        body.pop("target_currency")
        self.reject("fx-quotes", body, "SAME_CURRENCY_QUOTE")
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    def test_fx_quote_fee_precision_follows_each_currency(self):
        # sender_fee uses the source currency, receiver_fee uses the target currency.
        self.reject("fx-quotes", self.quote_body("JPY", HOME, rate="0.24", sender_fee="1.50"),
                    "AMOUNT_PRECISION_INVALID")
        self.quote("JPY", HOME, rate="0.24", sender_fee="2", receiver_fee="1.50")
        self.reject("fx-quotes", self.quote_body(HOME, "JPY", rate="4.1", receiver_fee="1.50"),
                    "AMOUNT_PRECISION_INVALID")
        self.quote(HOME, "JPY", rate="4.1", sender_fee="1.50", receiver_fee="2")
        self.assertEqual(FXQuote.objects.filter(owner=self.user).count(), 2)

    def make_corridor(self, source, target, enabled=True, tier="standard", **extra):
        values = dict(
            code="test-" + uuid4().hex[:12], provider="test-provider", tier=tier,
            source_currency=source, target_currency=target, enabled=enabled,
            min_amount=Decimal("1.00"), max_amount=Decimal("1000000.00"), fee_fixed=Decimal("0"),
            fee_percent=Decimal("0"), fx_margin_bps=0, settlement_min_days=0, settlement_days=1,
        )
        values.update(extra)
        return model("Corridor").objects.create(**values)

    def test_fx_quote_with_matching_corridor(self):
        corridor = self.make_corridor("GBP", HOME)
        quote = self.quote("GBP", HOME, rate="44", corridor_id=str(corridor.id))
        self.assertEqual(str(FXQuote.objects.get(pk=quote["id"]).corridor_id), str(corridor.id))

    def test_fx_quote_corridor_currency_mismatch(self):
        corridor = self.make_corridor("GBP", HOME)
        self.reject("fx-quotes", self.quote_body("USD", HOME, rate="35", corridor_id=str(corridor.id)),
                    "CORRIDOR_CURRENCY_MISMATCH")
        self.reject("fx-quotes", self.quote_body("GBP", "USD", rate="1.2", corridor_id=str(corridor.id)),
                    "CORRIDOR_CURRENCY_MISMATCH")
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    def test_fx_quote_corridor_disabled(self):
        corridor = self.make_corridor("GBP", HOME, enabled=False)
        self.reject("fx-quotes", self.quote_body("GBP", HOME, rate="44", corridor_id=str(corridor.id)),
                    "CORRIDOR_DISABLED")
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    # ------------------------------------------------------------ corridors
    def test_corridors_list_only_enabled_and_filter(self):
        enabled = self.make_corridor("GBP", "JPY")
        disabled = self.make_corridor("GBP", "JPY", enabled=False, tier="economy")
        response = self.get("corridors")
        self.assertEqual(response.status_code, 200, str(response.data))
        everything = items(response.data)
        ids = {str(row["id"]) for row in everything}
        self.assertIn(str(enabled.id), ids)
        self.assertNotIn(str(disabled.id), ids)
        self.assertTrue(all(row["enabled"] for row in everything if "enabled" in row))
        response = self.get("corridors", {"source_currency": "GBP", "target_currency": "JPY"})
        self.assertEqual(response.status_code, 200, str(response.data))
        filtered = items(response.data)
        self.assertEqual([str(row["id"]) for row in filtered], [str(enabled.id)])
        for field in ("code", "provider", "tier", "source_currency", "target_currency", "min_amount",
                      "max_amount", "fee_fixed", "fee_percent", "fx_margin_bps",
                      "settlement_min_days", "settlement_days"):
            self.assertIn(field, filtered[0])

    def test_seeded_corridors_have_three_tiers(self):
        for source, target in SEEDED_PAIRS:
            response = self.get("corridors", {"source_currency": source, "target_currency": target})
            self.assertEqual(response.status_code, 200, str(response.data))
            rows = items(response.data)
            self.assertTrue(all(r["source_currency"] == source and r["target_currency"] == target
                                for r in rows))
            self.assertEqual(sorted(r["tier"] for r in rows), TIERS, (source, target))

    # ------------------------------------------------------------- fx rates
    def test_fx_rate_fixture_and_snapshot_cache(self):
        snapshots = model("FxRateSnapshot").objects
        response = self.get("fx-rates", {"base": "CNY", "quote": HOME})
        self.assertEqual(response.status_code, 200, str(response.data))
        data = response.data["data"]
        self.assertEqual((data["base"], data["quote"]), ("CNY", HOME))
        self.assertEqual(D(data["rate"]), FIXTURE["CNY"])
        self.assertEqual(data["source"], "fixture")
        self.assertIs(data["stale"], False)
        self.assertEqual(data["issues"], [])
        self.assertIs(data["is_reference_rate"], True)
        for field in ("rate_date", "fetched_at"):
            self.assertIn(field, data)
        self.assertEqual(snapshots.filter(base="CNY", quote=HOME).count(), 1)
        self.assertEqual(self.get("fx-rates", {"base": "CNY", "quote": HOME}).status_code, 200)
        self.assertEqual(snapshots.filter(base="CNY", quote=HOME).count(), 1)

    def test_fx_rate_converts_an_optional_amount(self):
        response = self.get("fx-rates", {"base": "CNY", "quote": HOME, "amount": "5000.00"})
        self.assertEqual(response.status_code, 200, str(response.data))
        data = response.data["data"]
        self.assertEqual(data["amount"], "5000.00")
        self.assertEqual(D(data["converted"]), (Decimal("5000.00") * FIXTURE["CNY"]).quantize(Decimal("0.01")))
        self.assertIs(data["is_reference_rate"], True)
        self.assertNotIn("converted", self.get("fx-rates", {"base": "CNY", "quote": HOME}).data["data"])
        for bad in ("0", "-5", "abc", "1.234", "NaN"):
            self.assertEqual(self.get("fx-rates", {"base": "CNY", "quote": HOME, "amount": bad}).status_code, 400, bad)

    def test_fx_rate_cross_rate_goes_through_home(self):
        response = self.get("fx-rates", {"base": "CNY", "quote": "USD"})
        self.assertEqual(response.status_code, 200, str(response.data))
        self.assertLessEqual(abs(D(response.data["data"]["rate"]) - FIXTURE["CNY"] / FIXTURE["USD"]), TEN_DP)

    def old_snapshot(self, base, quote, rate, days_old=0):
        return model("FxRateSnapshot").objects.create(
            base=base, quote=quote, rate=D(rate), source="fixture", basis="",
            rate_date=timezone.localdate() - timedelta(days=days_old),
            fetched_at=timezone.now() - timedelta(days=max(days_old, 1)))

    def test_fx_rate_fetch_failure_falls_back_to_last_snapshot(self):
        self.old_snapshot("CNY", HOME, "4.5")
        with patch("finance.fx_rates._fixture_fetch", side_effect=OSError("network down")):
            response = self.get("fx-rates", {"base": "CNY", "quote": HOME})
        self.assertEqual(response.status_code, 200, str(response.data))
        self.assertEqual(D(response.data["data"]["rate"]), Decimal("4.5"))
        self.assertIn("FX_FETCH_FAILED", response.data["data"]["issues"])

    def test_fx_rate_unavailable_without_snapshot(self):
        with patch("finance.fx_rates._fixture_fetch", side_effect=OSError("network down")):
            response = self.get("fx-rates", {"base": "CNY", "quote": HOME})
        self.assertEqual(response.status_code, 503, str(response.data))
        self.assertIn("FX_RATE_UNAVAILABLE", str(response.data))

    def test_live_quote_refused_on_stale_rate(self):
        self.old_snapshot("CNY", HOME, "4.5", days_old=10)
        with patch("finance.fx_rates._fixture_fetch", side_effect=OSError("network down")):
            response = self.get("fx-rates", {"base": "CNY", "quote": HOME})
            self.assertIs(response.data["data"]["stale"], True)
            self.assertIn("STALE_FX_RATE", response.data["data"]["issues"])
            corridor = self.corridor("CNY", HOME)
            self.reject("fx-quotes/live", {"corridor_id": str(corridor["id"]), "send_amount": "1000.00"},
                        "STALE_FX_RATE", status=409)
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    def test_live_quote_refused_on_cached_stale_rate(self):
        # Fetched recently (inside the cache window) but the rate date is 10 days old.
        snapshot = self.old_snapshot("CNY", HOME, "4.5", days_old=10)
        model("FxRateSnapshot").objects.filter(pk=snapshot.pk).update(fetched_at=timezone.now())
        corridor = self.corridor("CNY", HOME)
        self.reject("fx-quotes/live", {"corridor_id": str(corridor["id"]), "send_amount": "1000.00"},
                    "STALE_FX_RATE", status=409)
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    def test_live_quote_refused_when_only_fallback_snapshot(self):
        self.old_snapshot("CNY", HOME, "4.5", days_old=0)
        corridor = self.corridor("CNY", HOME)
        with patch("finance.fx_rates._fixture_fetch", side_effect=OSError("network down")):
            self.reject("fx-quotes/live", {"corridor_id": str(corridor["id"]), "send_amount": "1000.00"},
                        None, status=409)
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    # ------------------------------------------------------------ live quotes
    def test_live_quote_pricing_for_every_seeded_corridor(self):
        corridor_ids = []
        for source, target in SEEDED_PAIRS:
            for tier in TIERS:
                corridor = self.corridor(source, target, tier)
                amount = format(max(D(corridor["min_amount"]), Decimal("1000")), ".2f")
                expected = price(corridor, amount)
                before = timezone.now()
                data = self.live(source, target, amount, tier)
                label = (source, target, tier)
                self.assertEqual(data["source_currency"], source, label)
                self.assertEqual(data["target_currency"], target, label)
                self.assertEqual(D(data["quoted_amount"]), D(amount), label)
                self.assertEqual(D(data["mid_rate"]), expected["mid"], label)
                self.assertEqual(D(data["rate"]), expected["rate"], label)
                self.assertEqual(D(data["sender_fee"]), expected["sender_fee"], label)
                self.assertEqual(D(data["receiver_fee"]), Decimal("0"), label)
                self.assertEqual(D(data["net_received"]), expected["target"], label)
                self.assertEqual(data["rate_source"], "fixture", label)
                self.assertIn("rate_date", data)
                corridor_ids.append((label, str(data.get("corridor_id")), str(corridor["id"])))
                self.assertEqual(data["settlement_days"], corridor["settlement_days"], label)
                stored = FXQuote.objects.get(pk=data["id"])
                self.assertEqual(stored.rate, expected["rate"])
                self.assertEqual(stored.quoted_amount, D(amount))
                self.assertTrue(before + timedelta(minutes=9) < stored.expires_at
                                <= timezone.now() + timedelta(minutes=10, seconds=5), label)
        # docs/fx-rates.md: the live quote response also carries corridor_id.
        for label, returned, expected in corridor_ids:
            self.assertEqual(returned, expected, label)

    def test_live_quote_sender_fee_rounds_half_up(self):
        corridor = self.corridor("CNY", HOME, "economy")
        self.assertEqual(D(corridor["fee_percent"]), Decimal("0.0015"))  # fixture assumption
        # 110.00 * 0.0015 = 0.165 -> 0.17 (HALF_EVEN would give 0.16)
        self.assertEqual(D(self.live("CNY", HOME, "110.00")["sender_fee"]), Decimal("0.17"))

    def test_live_quote_amount_range_and_precision(self):
        corridor = self.corridor("CNY", HOME)
        low, high = D(corridor["min_amount"]), D(corridor["max_amount"])
        body = {"corridor_id": str(corridor["id"])}
        self.reject("fx-quotes/live", {**body, "send_amount": str(low - Decimal("0.01"))},
                    "CORRIDOR_AMOUNT_OUT_OF_RANGE")
        self.reject("fx-quotes/live", {**body, "send_amount": str(high + Decimal("0.01"))},
                    "CORRIDOR_AMOUNT_OUT_OF_RANGE")
        self.reject("fx-quotes/live", {**body, "send_amount": "1000.001"}, "AMOUNT_PRECISION_INVALID")
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())
        self.live("CNY", HOME, str(low))
        self.live("CNY", HOME, str(high))

    def test_live_quote_on_disabled_corridor(self):
        corridor = self.corridor("CNY", HOME)
        model("Corridor").objects.filter(pk=corridor["id"]).update(enabled=False)
        self.reject("fx-quotes/live", {"corridor_id": str(corridor["id"]), "send_amount": "1000.00"},
                    "CORRIDOR_DISABLED")
        self.assertFalse(FXQuote.objects.filter(owner=self.user).exists())

    # ----------------------------------------------------------- conversions
    def test_convert_foreign_to_home(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "1000.00")
        before_version = self.version()
        data = self.convert(quote["id"], "1000.00")
        self.assertTrue(CONVERSION_FIELDS <= set(data), set(data))
        self.assertEqual(str(data["quote_id"]), quote["id"])
        self.assertEqual(data["source_currency"], "CNY")
        self.assertEqual(data["target_currency"], HOME)
        self.assertEqual(D(data["source_amount"]), Decimal("1000.00"))
        # economy: rate 4.60 * (1 - 25/10000) = 4.5885; fee 0 + 1000 * 0.0015 = 1.50
        # (1000 - 1.50) * 4.5885 = 4581.61725 -> 4581.62
        self.assertEqual(D(data["rate"]), Decimal("4.5885"))
        self.assertEqual(D(data["sender_fee"]), Decimal("1.50"))
        self.assertEqual(D(data["receiver_fee"]), Decimal("0"))
        self.assertEqual(D(data["target_amount"]), Decimal("4581.62"))
        self.assertIs(data["is_simulated"], True)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertEqual(self.home(), OPENING + Decimal("4581.62"))

        conversion = model("CurrencyConversion").objects.get(pk=data["id"])
        self.assertEqual(str(conversion.quote_id), quote["id"])
        legs = list(DemoLedgerEntry.objects.filter(conversion=conversion).order_by("amount"))
        self.assertEqual(len(legs), 2)
        debit, credit = legs
        self.assertEqual((debit.currency, debit.amount), ("CNY", Decimal("-1000.00")))
        self.assertEqual((credit.currency, credit.amount), (HOME, Decimal("4581.62")))
        self.assertEqual(debit.sequence, data["debit_sequence"])
        self.assertEqual(credit.sequence, data["credit_sequence"])
        self.assertNotEqual(debit.sequence, credit.sequence)
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)

        self.assertEqual(self.version(), before_version + 1)
        events = {e["id"]: e for e in self.state().snapshot["events"]}
        event = events["conversion:" + str(data["id"])]
        self.assertEqual(event["kind"], "income")
        self.assertEqual(D(event["amount"]), Decimal("4581.62"))
        self.assertIn(event["settled_sequence"], {data["debit_sequence"], data["credit_sequence"]})
        self.assertTrue(AuditEvent.objects.filter(owner=self.user, action="wallet.conversion_settled").exists())
        self.assert_invariant()

    def test_convert_home_to_foreign(self):
        quote = self.live(HOME, "CNY", "1000.00")
        corridor = self.corridor(HOME, "CNY")
        expected = price(corridor, "1000.00")
        self.assertEqual(expected["mid"], Decimal("0.2173913043"))
        before_version = self.version()
        data = self.convert(quote["id"], "1000.00")
        self.assertEqual(D(data["target_amount"]), expected["target"])
        self.assertEqual(self.home(), OPENING - Decimal("1000.00"))
        self.assertEqual(self.foreign("CNY"), expected["target"])
        legs = list(DemoLedgerEntry.objects.filter(conversion_id=data["id"]).order_by("amount"))
        self.assertEqual([(leg.currency, leg.amount) for leg in legs],
                         [(HOME, Decimal("-1000.00")), ("CNY", expected["target"])])
        self.assertEqual(self.version(), before_version + 1)
        event = {e["id"]: e for e in self.state().snapshot["events"]}["conversion:" + str(data["id"])]
        self.assertEqual(event["kind"], "expense")
        self.assertEqual(D(event["amount"]), Decimal("1000.00"))
        self.assertIn(event["settled_sequence"], {data["debit_sequence"], data["credit_sequence"]})
        self.assertFalse(model("WalletBalance").objects.filter(currency=HOME).exists())
        self.assert_invariant()

    def test_convert_rounds_half_up_to_target_precision(self):
        self.hold("CNY", "1000.00")
        # economy: fee 130.20 * 0.0015 = 0.1953 -> 0.20; 130.20 - 0.20 = 130.00
        # 130.00 * 4.5885 = 596.505 -> 596.51 (HALF_EVEN would give 596.50)
        quote = self.live("CNY", HOME, "130.20")
        self.assertEqual(D(quote["net_received"]), Decimal("596.51"))
        self.assertEqual(D(self.convert(quote["id"], "130.20")["target_amount"]), Decimal("596.51"))
        self.assert_invariant()

    def test_manual_quote_exploit_is_rejected(self):
        """Regression: a student-priced quote must not mint balance through conversions."""
        quote = self.quote(HOME, "CNY", rate="1000000")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), "QUOTE_NOT_EXECUTABLE")
        self.assertEqual(self.footprint(), before)
        self.assertEqual(self.foreign("CNY"), Decimal("0"))
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        self.hold("CNY", "1000.00")
        quote = self.quote("CNY", HOME, rate="1000000")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "100.00"), "QUOTE_NOT_EXECUTABLE")
        self.assertEqual(self.footprint(), before)

    def test_manual_quote_attached_to_corridor_is_still_not_executable(self):
        self.hold("CNY", "1000.00")
        corridor = self.corridor("CNY", HOME)
        quote = self.quote("CNY", HOME, rate="999", corridor_id=str(corridor["id"]))
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "100.00"), "QUOTE_NOT_EXECUTABLE")
        self.assertEqual(self.footprint(), before)

    def test_manual_cross_currency_quote_cannot_convert(self):
        self.hold("CNY", "1000.00")
        quote = self.quote("CNY", "USD", rate="0.14")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "100.00"), "QUOTE_NOT_EXECUTABLE")
        self.assertEqual(self.footprint(), before)

    def test_quote_amount_mismatch(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "1000.00")
        before = self.footprint()
        for amount in ("999.99", "1000.01"):
            self.reject("conversions", self.convert_body(quote["id"], amount), "QUOTE_AMOUNT_MISMATCH")
        self.assertEqual(self.footprint(), before)
        self.convert(quote["id"], "1000.00")

    def test_corridor_disabled_after_quoting(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "1000.00")
        model("Corridor").objects.filter(pk=self.corridor("CNY", HOME)["id"]).update(enabled=False)
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), "CORRIDOR_DISABLED")
        self.assertEqual(self.footprint(), before)

    def test_corridor_range_rechecked_at_conversion(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "1000.00")
        model("Corridor").objects.filter(pk=self.corridor("CNY", HOME)["id"]).update(
            min_amount=Decimal("1500.00"))
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), "CORRIDOR_AMOUNT_OUT_OF_RANGE")
        self.assertEqual(self.footprint(), before)

    def test_reserve_required_for_home_source(self):
        quote = self.live(HOME, "CNY", "65000.01")
        before = self.footprint()
        # available 80000 - 65000.01 < reserve 15000
        self.reject("conversions", self.convert_body(quote["id"], "65000.01"), "RESERVE_REQUIRED")
        self.assertEqual(self.footprint(), before)
        self.convert_live(HOME, "CNY", "65000.00")
        self.assertEqual(self.home(), RESERVE)
        self.assert_invariant()

    def test_reserve_check_uses_available_balance_net_of_pending_payments(self):
        self.receive_home("9000.00")
        self.pending_payment("rent")  # balance 89000, available 80000
        quote = self.live(HOME, "CNY", "65000.01")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "65000.01"), "RESERVE_REQUIRED")
        self.assertEqual(self.footprint(), before)

    def test_quote_consumed_on_reuse(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "500.00")
        self.convert(quote["id"], "500.00")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "500.00"), "QUOTE_CONSUMED")
        self.assertEqual(self.footprint(), before)

    def test_quote_expired(self):
        self.hold("CNY", "1000.00")
        quote = self.live("CNY", HOME, "500.00")
        FXQuote.objects.filter(pk=quote["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "500.00"), "QUOTE_EXPIRED")
        self.assertEqual(self.footprint(), before)

    def test_quote_of_another_user_cannot_be_used(self):
        self.client.force_authenticate(self.other)
        self.client.post("/api/v2/state/", {"expected_version": 0, "snapshot": deepcopy(BASE)}, format="json")
        self.post("demo/initialize", {"state_version": 1}, user=self.other)
        foreign_quote = self.live("CNY", HOME, "500.00", user=self.other)
        self.hold("CNY", "1000.00")
        before = self.footprint()
        response = self.call("conversions", self.convert_body(foreign_quote["id"], "500.00"))
        self.assertIn(response.status_code, {400, 404}, str(response.data))
        self.assertEqual(self.footprint(), before)
        self.assertIsNone(FXQuote.objects.get(pk=foreign_quote["id"]).consumed_at)

    def test_insufficient_balance(self):
        quote = self.live("CNY", HOME, "100.00")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "100.00"), "INSUFFICIENT_BALANCE")
        self.assertEqual(self.footprint(), before)
        self.hold("CNY", "1000.00")
        quote = self.live("CNY", HOME, "1000.01")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "1000.01"), "INSUFFICIENT_BALANCE")
        self.assertEqual(self.footprint(), before)
        self.convert_live("CNY", HOME, "1000.00")
        self.assertEqual(self.foreign("CNY"), Decimal("0.00"))
        self.assert_invariant()

    def test_conversion_not_positive(self):
        # A test-only corridor whose fixed fee swallows the minimum amount, and one whose
        # margin makes the JPY result round to zero. The spec allows the refusal either when
        # quoting or when converting, but the code must be CONVERSION_NOT_POSITIVE.
        self.hold("CNY", "1000.00")
        fee_eats_all = self.make_corridor("CNY", HOME, tier="test-fee", min_amount=Decimal("1.00"),
                                          fee_fixed=Decimal("50.00"))
        tiny = self.make_corridor(HOME, "JPY", tier="test-tiny", min_amount=Decimal("0.01"),
                                  fx_margin_bps=9000)
        for corridor, amount in [(fee_eats_all, "40.00"), (fee_eats_all, "50.00"), (tiny, "0.10")]:
            before = self.footprint()
            response = self.call("fx-quotes/live", {"corridor_id": str(corridor.id), "send_amount": amount})
            if response.status_code == 201:
                response = self.call("conversions", self.convert_body(response.data["data"]["id"], amount))
            self.assertEqual(response.status_code, 400, str(response.data))
            if amount != "50.00":  # source_amount == sender_fee: spec does not pin the code
                self.assertIn("CONVERSION_NOT_POSITIVE", str(response.data))
            self.assertEqual(self.footprint(), before)

    def test_amount_precision_invalid(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "1000.00")
        before = self.footprint()
        response = self.reject("conversions", self.convert_body(quote["id"], "1000.001"), None)
        # Both rules apply to a 3-dp amount against a 2-dp quote; the spec does not order them.
        self.assertTrue("AMOUNT_PRECISION_INVALID" in str(response.data)
                        or "QUOTE_AMOUNT_MISMATCH" in str(response.data), response.data)
        self.assertEqual(self.footprint(), before)
        self.post("funding-sources", {"economic_key": "fractional-yen", "kind": "external_savings",
                                      "currency": "JPY", "amount": "100.50", "available_on": BASE["as_of"],
                                      "certainty": "confirmed"}, code=400)

    def test_stale_state_version_conflicts(self):
        self.receive_home("100.00")  # version -> 2
        self.hold("CNY", "1000.00")
        quote = self.live("CNY", HOME, "500.00")
        current = self.version()
        before = self.footprint()
        for stale in (current - 1, current + 1):
            response = self.call("conversions", self.convert_body(quote["id"], "500.00", version=stale))
            self.assertEqual(response.status_code, 409, str(response.data))
        self.assertEqual(self.footprint(), before)
        self.convert(quote["id"], "500.00", version=current)

    def test_idempotent_replay_does_not_double_post(self):
        self.hold("CNY", "1000.00")
        quote = self.live("CNY", HOME, "500.00")
        body = self.convert_body(quote["id"], "500.00")
        first = self.post("conversions", body, key="convert-once")
        after_first = self.footprint()
        response = self.call("conversions", body, key="convert-once")
        self.assertEqual(response.status_code, 200, str(response.data))
        self.assertEqual(response.data["data"], first)
        self.assertEqual(self.footprint(), after_first)
        self.assertEqual(model("CurrencyConversion").objects.count(), 1)
        self.reject("conversions", {**body, "source_amount": "400.00"}, None, key="convert-once")
        self.assertEqual(self.footprint(), after_first)

    def test_failure_after_ledger_writes_rolls_back_everything(self):
        self.hold("CNY", "1000.00")
        quote = self.live("CNY", HOME, "500.00")
        before = self.footprint()
        with patch("finance.workflow_common.AuditEvent.objects.create", side_effect=RuntimeError("fault")):
            with self.assertRaises(RuntimeError):
                self.call("conversions", self.convert_body(quote["id"], "500.00"))
        self.assertEqual(self.footprint(), before)
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)

    # --------------------------------------------------- reserved prefix
    def test_user_cannot_add_conversion_prefixed_event(self):
        state = self.state()
        snapshot = deepcopy(state.snapshot)
        snapshot["events"].append({"id": "conversion:" + str(uuid4()), "label": "Forged",
                                   "kind": "income", "amount": "1000.00", "date": BASE["as_of"],
                                   "certainty": "confirmed"})
        response = self.client.post("/api/v2/state/", {"expected_version": state.version,
                                                       "snapshot": snapshot}, format="json")
        self.assertEqual(response.status_code, 400, str(response.data))
        self.assertEqual(self.version(), state.version)

    def test_state_round_trip_keeps_conversion_events(self):
        self.hold("CNY", "1000.00")
        self.convert_live("CNY", HOME, "500.00")
        self.convert_live(HOME, "CNY", "1000.00")
        self.client.force_authenticate(self.user)
        state = self.client.get("/api/v2/state/").data
        response = self.client.post("/api/v2/state/", {"expected_version": state["version"],
                                                       "snapshot": state["snapshot"]}, format="json")
        self.assertEqual(response.status_code, 201, str(response.data))

    # ------------------------------------------------------ DB constraints
    def test_database_rejects_negative_balances(self):
        self.hold("CNY", "10.00")
        row = model("WalletBalance").objects.get(owner=self.user, currency="CNY")
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            model("WalletBalance").objects.filter(pk=row.pk).update(balance=Decimal("-0.01"))
        self.assertIn("wallet_balance_nonnegative", str(caught.exception))
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            DemoWallet.objects.filter(owner=self.user).update(balance=Decimal("-0.01"))
        self.assertIn("demo_wallet_balance_nonnegative", str(caught.exception))
        self.assertEqual(self.foreign("CNY"), Decimal("10.00"))
        self.assertEqual(self.home(), OPENING)

    def test_database_enforces_one_balance_row_per_currency(self):
        self.hold("CNY", "10.00")
        row = model("WalletBalance").objects.get(owner=self.user, currency="CNY")
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            model("WalletBalance").objects.create(owner=self.user, wallet=row.wallet, currency="CNY",
                                                  balance=Decimal("0"))
        self.assertIn("wallet_balance_owner_currency_unique", str(caught.exception))

    def test_currency_conversion_is_immutable(self):
        if connection.vendor != "postgresql":
            self.skipTest("Immutability triggers are PostgreSQL-only")
        self.hold("CNY", "1000.00")
        data = self.convert_live("CNY", HOME, "500.00")
        table = model("CurrencyConversion")._meta.db_table
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(f'UPDATE "{table}" SET quote_id = quote_id WHERE id = %s', [data["id"]])

    # ------------------------------------------------------- invariants
    def test_mixed_sequence_keeps_ledger_invariant(self):
        self.receive_home("9000.00")
        self.assert_invariant()
        self.hold("CNY", "2000.00")
        self.assert_invariant()
        first = self.convert_live("CNY", HOME, "1000.00")
        self.assertEqual(D(first["target_amount"]), Decimal("4581.62"))
        self.assert_invariant()
        payment = self.pending_payment("rent")
        row = self.balance_row(HOME)
        self.assertEqual(D(row["available_balance"]), D(row["balance"]) - Decimal("9000.00"))
        second = self.convert_live(HOME, "CNY", "1000.00")
        self.assert_invariant()
        self.settle(payment)
        self.assert_invariant()
        third = self.convert_live("CNY", HOME, "500.00", tier="express")
        self.assert_invariant()
        self.assertEqual(self.home(), OPENING + Decimal("9000.00") + Decimal("4581.62") - Decimal("1000.00")
                         - Decimal("9000.00") + D(third["target_amount"]))
        self.assertEqual(self.foreign("CNY"), Decimal("2000.00") - Decimal("1000.00")
                         + D(second["target_amount"]) - Decimal("500.00"))
        settled = DemoLedgerEntry.objects.get(payment_id=payment["id"])
        self.assertEqual((settled.currency, settled.amount), (HOME, Decimal("-9000.00")))

    # Dozens of conversions in seconds exceed the 10/hour step-up budget meant for a real student.
    @override_settings(STUDYFLOW_THROTTLE_RATES={**settings.STUDYFLOW_THROTTLE_RATES, "step_up": "200/hour",
                                                 "money": "200/hour"})
    def test_randomized_sequence_keeps_invariants(self):
        rng = random.Random(20261007)

        def amount_between(low, high):
            low_cents, high_cents = int(low * 100), int(high * 100)
            return format(Decimal(rng.randint(low_cents, max(low_cents, high_cents))) / 100, ".2f")

        successes = rejections = 0
        for step in range(24):
            op = rng.choice(["receive", "hold", "convert", "convert", "convert", "convert"])
            if op == "receive":
                self.receive_home(amount_between(Decimal("100"), Decimal("5000")))
                successes += 1
            elif op == "hold":
                self.hold(rng.choice(["CNY", "USD", "EUR"]), amount_between(Decimal("10"), Decimal("3000")))
                successes += 1
            else:
                source, target = rng.choice(SEEDED_PAIRS)
                tier = rng.choice(TIERS)
                corridor = self.corridor(source, target, tier)
                low, high = D(corridor["min_amount"]), D(corridor["max_amount"])
                balance = self.home() if source == HOME else self.foreign(source)
                amount = amount_between(low, min(high, max(low, balance * Decimal("1.2"))))
                quote = self.live(source, target, amount, tier)
                before = self.footprint()
                if rng.random() < 0.15:
                    amount = format(D(amount) + Decimal("0.01"), ".2f")  # deliberate mismatch
                response = self.call("conversions", self.convert_body(quote["id"], amount))
                self.assertIn(response.status_code, {201, 400}, (step, response.status_code, response.data))
                if response.status_code == 201:
                    successes += 1
                    self.assertEqual(D(response.data["data"]["target_amount"]), price(corridor, amount)["target"])
                    self.assertEqual(len(self.footprint()["ledger"]), len(before["ledger"]) + 2)
                else:
                    rejections += 1
                    self.assertEqual(self.footprint(), before, (step, response.data))
            self.assert_invariant(check_api=False)
        self.assert_invariant()
        self.assertGreaterEqual(successes, 8)
        self.assertGreaterEqual(rejections, 1)
