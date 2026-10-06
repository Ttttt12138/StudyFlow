"""Contract tests for docs/remittance.md (remittance orders).

Everything goes through the real /api/v2/ routes with an Idempotency-Key on every POST.
The ORM is only used to arrange edge cases that have no API (expired quotes, mutated
corridors) and to verify persisted state (ledger legs, history rows, constraints).
Expected amounts come from the documented pricing rules, never from implementation output.

Step-up / approval note: every submit goes through RemittanceHarness.submit(), every
foreign-balance top-up through fund_foreign() and every live quote through live_quote(),
so later contract changes to those flows only touch one helper each.
"""
from copy import deepcopy
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, localcontext
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from auto_test.test_multicurrency import (
    FX_SETTINGS, HOME, OPENING, PASSWORD, RESERVE, D, MultiCurrencyHarness, items, model, price, unit,
)
from finance.models import AuditEvent
from finance.policy_flow import client_flow, step_up_header
from finance.workflow_models import DemoLedgerEntry, DemoWallet, FXQuote

TERMINAL = {"CANCELLED", "EXPIRED", "REFUNDED", "RECONCILED"}
ADAPTER_OUTCOMES = ["dispatched", "delivered", "failed", "unknown"]
ACTIONS = ["cancel", "submit", "reconcile"] + ADAPTER_OUTCOMES
STATUSES = ["CREATED", "SUBMITTED", "IN_TRANSIT", "DELIVERED", "RECONCILED",
            "CANCELLED", "EXPIRED", "UNKNOWN", "REFUNDED"]
# docs/remittance.md state table: (status, action) -> target status.
ALLOWED = {
    ("CREATED", "cancel"): "CANCELLED",
    ("CREATED", "submit"): "SUBMITTED",
    ("SUBMITTED", "dispatched"): "IN_TRANSIT",
    ("SUBMITTED", "delivered"): "DELIVERED",
    ("IN_TRANSIT", "delivered"): "DELIVERED",
    ("UNKNOWN", "delivered"): "DELIVERED",
    ("SUBMITTED", "failed"): "REFUNDED",
    ("IN_TRANSIT", "failed"): "REFUNDED",
    ("UNKNOWN", "failed"): "REFUNDED",
    ("SUBMITTED", "unknown"): "UNKNOWN",
    ("IN_TRANSIT", "unknown"): "UNKNOWN",
    ("DELIVERED", "reconcile"): "RECONCILED",
}
# "Re-sending a result that already took effect returns the current order without re-posting."
REPLAY = {
    ("IN_TRANSIT", "dispatched"), ("DELIVERED", "delivered"), ("RECONCILED", "delivered"),
    ("REFUNDED", "failed"), ("UNKNOWN", "unknown"), ("CANCELLED", "cancel"),
    ("RECONCILED", "reconcile"), ("SUBMITTED", "submit"),
}
# Contract ambiguity: is `submit` on an order that already moved past SUBMITTED a replay of an
# effected result or an INVALID_TRANSITION? Either response is accepted, but nothing may change.
SUBMIT_AFTER_SUBMISSION = {"IN_TRANSIT", "DELIVERED", "RECONCILED", "UNKNOWN", "REFUNDED"}


class RemittanceHarness(MultiCurrencyHarness):
    username = "rm-student"

    def bootstrap(self):
        super().bootstrap()
        from finance.corridors import ensure_default_corridors
        ensure_default_corridors()

    # ---------------------------------------------------------- single-entry helpers
    def fund_foreign(self, currency, amount):
        """The one way tests create a foreign-currency balance (operator receive, held)."""
        return self.hold(currency, amount)

    def live_quote(self, source, target, amount, tier="economy", code=201, user=None):
        """The one way tests create a server-priced corridor quote (POST fx-quotes/live/)."""
        return self.live(source, target, amount, tier=tier, code=code, user=user)

    def submit(self, order, version=None, code=201, error=None, key=None, user=None, client=None):
        """The ONE helper for POST remittance-orders/{id}/submit/.

        code=None returns the raw response without assertions (used from threads, where
        `client` is a thread-local APIClient that is already authenticated).
        """
        order_id = self.oid(order)
        if version is None:
            version = model("RemittanceOrder").objects.get(pk=order_id).version
        path = "/api/v2/remittance-orders/" + order_id + "/submit/"
        body = {"expected_version": version}
        headers = {"HTTP_IDEMPOTENCY_KEY": key or str(uuid4())}
        actor = user or self.user
        if not actor.is_staff:
            # T2 submit: the documented step-up (and approval when over the limit), via the API.
            headers.update(step_up_header(client_flow(actor, PASSWORD, self.approver),
                                          "remittance-orders/" + order_id + "/submit", body))
        if client is not None:
            response = client.post(path, body, format="json", **headers)
        else:
            self.client.force_authenticate(user or self.user)
            try:
                response = self.client.post(path, body, format="json", **headers)
            finally:
                self.client.force_authenticate(self.user)
        if code is None:
            return response
        self.assertEqual(response.status_code, code, str(response.data))
        if error:
            self.assertIn(error, str(response.data))
        return response.data.get("data", response.data) if code < 300 else response

    # ---------------------------------------------------------- other helpers
    @staticmethod
    def oid(order):
        return str(order["id"] if isinstance(order, dict) else getattr(order, "id", order))

    def beneficiary(self, verified=True, user=None):
        item = self.post("beneficiaries", {"name": "Demo university", "destination_label": "MOCK-ACCT"},
                         user=user)
        if verified:
            self.verify_beneficiary(item, True)
        return item

    def verify_beneficiary(self, item, verified):
        return self.post("beneficiaries/" + item["id"] + "/verify", {"verified": verified}, operator=True)

    def order_body(self, quote, recipient="SELF", beneficiary=None, purpose="living", **extra):
        body = {"quote_id": self.oid(quote), "recipient": recipient, "purpose": purpose}
        if beneficiary is not None:
            body["beneficiary_id"] = self.oid(beneficiary)
        body.update(extra)
        return body

    def create(self, quote, recipient="SELF", beneficiary=None, purpose="living", code=201, error=None,
               user=None, key=None, **extra):
        body = self.order_body(quote, recipient, beneficiary, purpose, **extra)
        if code >= 300:
            return self.reject("remittance-orders", body, error, status=code, user=user, key=key)
        return self.post("remittance-orders", body, code=code, user=user, key=key)

    def new_order(self, source="CNY", target=None, amount="1000.00", tier="economy", fund=True, **kwargs):
        """Live quote + order; funds a foreign source balance first unless fund=False."""
        target = target or (HOME if source != HOME else "CNY")
        if fund and source != HOME:
            self.fund_foreign(source, amount)
        quote = self.live_quote(source, target, amount, tier)
        return self.create(quote, **kwargs), quote

    def db(self, order):
        return model("RemittanceOrder").objects.get(pk=self.oid(order))

    def detail(self, order, user=None):
        response = self.get("remittance-orders/" + self.oid(order), user=user)
        self.assertEqual(response.status_code, 200, str(response.data))
        return response.data["data"]

    def command(self, order, action, version=None, code=201, error=None, note=None, key=None, user=None):
        """cancel / reconcile (student) and adapter outcomes (operator). submit has its own helper."""
        if action == "submit":
            return self.submit(order, version, code=code, error=error, key=key, user=user)
        if version is None:
            version = self.db(order).version
        body = {"expected_version": version}
        if note is not None:
            body["note"] = note
        operator = action in ADAPTER_OUTCOMES
        if operator:
            body["outcome"] = action
            path = "remittance-orders/" + self.oid(order) + "/adapter-event"
        else:
            path = "remittance-orders/" + self.oid(order) + "/" + action
        response = self.call(path, body, operator=operator and user is None, key=key, user=user)
        if code is None:
            return response
        self.assertEqual(response.status_code, code, str(response.data))
        if error:
            self.assertIn(error, str(response.data))
        return response.data.get("data", response.data) if code < 300 else response

    def adapter(self, order, outcome, **kwargs):
        return self.command(order, outcome, **kwargs)

    def expire(self, quote):
        FXQuote.objects.filter(pk=self.oid(quote)).update(expires_at=timezone.now() - timedelta(seconds=1))

    def legs(self, order):
        return {e.remittance_leg: e for e in DemoLedgerEntry.objects.filter(remittance_order_id=self.oid(order))}

    def history_rows(self, order):
        return list(model("RemittanceStatusEvent").objects.filter(order_id=self.oid(order))
                    .order_by("version").values_list("from_status", "to_status", "version"))

    def remittance_events(self, order=None):
        prefix = "remittance:" + (self.oid(order) + ":" if order is not None else "")
        return {e["id"]: e for e in self.state().snapshot["events"] if e["id"].startswith(prefix)}

    def ledger_count(self):
        return DemoLedgerEntry.objects.filter(owner=self.user).count()

    def drive(self, status, source="CNY", amount="1000.00"):
        """Create an order and drive it through the API into `status`."""
        order, quote = self.new_order(source, amount=amount)
        if status == "CREATED":
            return order
        if status == "CANCELLED":
            self.command(order, "cancel")
            return order
        if status == "EXPIRED":
            self.expire(quote)
            self.submit(order, code=None)
            self.assertEqual(self.db(order).status, "EXPIRED")
            return order
        self.submit(order)
        steps = {"SUBMITTED": [], "IN_TRANSIT": ["dispatched"], "DELIVERED": ["delivered"],
                 "RECONCILED": ["delivered", "reconcile"], "UNKNOWN": ["unknown"], "REFUNDED": ["failed"]}
        for action in steps[status]:
            self.command(order, action)
        self.assertEqual(self.db(order).status, status)
        return order

    def expected_breakdown(self, corridor, amount):
        """docs/remittance.md fee table, derived from docs/fx-rates.md pricing."""
        priced = price(corridor, amount)
        source = corridor["source_currency"]
        with localcontext() as context:
            context.prec = 48
            margin = (D(amount) - priced["sender_fee"]) * (priced["mid"] - priced["rate"]) / priced["mid"]
        margin = margin.quantize(unit(source), rounding=ROUND_HALF_UP)
        return {"sender_fee": priced["sender_fee"], "rate": priced["rate"], "mid_rate": priced["mid"],
                "fx_margin_cost": margin, "total_cost": priced["sender_fee"] + margin,
                "receive_amount": priced["target"]}


# The transition matrix submits dozens of orders in seconds; throttling itself is
# covered by auto_test/test_policy.py, so these suites raise the step-up/money rates.
@override_settings(**FX_SETTINGS, STUDYFLOW_THROTTLE_RATES={
    **settings.STUDYFLOW_THROTTLE_RATES, "step_up": "1000/hour", "money": "1000/hour"})
class RemittanceApiTests(RemittanceHarness, APITestCase):
    def setUp(self):
        self.bootstrap()

    # ================================================================ creation
    def test_create_self_order_shape_and_initial_history(self):
        order, quote = self.new_order(amount="1000.00", deadline="2026-10-09", reference="Oct living")
        self.assertEqual(order["status"], "CREATED")
        self.assertEqual(order["version"], 1)
        self.assertEqual(order["recipient"], "SELF")
        self.assertIsNone(order.get("beneficiary"))
        self.assertEqual(order["send_currency"], "CNY")
        self.assertEqual(order["receive_currency"], HOME)
        self.assertEqual(D(order["send_amount"]), D(quote["quoted_amount"]))
        self.assertEqual(order["deadline"], "2026-10-09")
        self.assertEqual(order["purpose"], "living")
        self.assertEqual([(h["from"], h["to"], h["version"]) for h in order["history"]], [("", "CREATED", 1)])
        self.assertEqual(self.history_rows(order), [("", "CREATED", 1)])
        # Creation reserves nothing: no ledger, balance and quote untouched.
        self.assertEqual(self.legs(order), {})
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        listed = items(self.get("remittance-orders").data)
        self.assertEqual([row["id"] for row in listed], [order["id"]])

    def test_create_requires_idempotency_key_and_replays_same_key(self):
        quote = self.live_quote("CNY", HOME, "1000.00")
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v2/remittance-orders/", self.order_body(quote), format="json")
        self.assertEqual(response.status_code, 400, str(response.data))
        self.assertEqual(model("RemittanceOrder").objects.count(), 0)
        first = self.create(quote, key="create-once")
        replay = self.call("remittance-orders", self.order_body(quote), key="create-once")
        self.assertEqual(replay.status_code, 200, str(replay.data))
        self.assertEqual(replay.data["data"]["id"], first["id"])
        self.assertEqual(model("RemittanceOrder").objects.count(), 1)

    def test_fee_breakdown_economy_cny_to_thb(self):
        self.fund_foreign("CNY", "1000.00")
        quote = self.live_quote("CNY", HOME, "1000.00")
        order = self.create(quote)
        expected = self.expected_breakdown(self.corridor("CNY", HOME), "1000.00")
        # Hand-checked: fee 1.50, rate 4.5885, margin 998.50*0.0115/4.6 = 2.49625 -> 2.50.
        self.assertEqual(expected["sender_fee"], Decimal("1.50"))
        self.assertEqual(expected["fx_margin_cost"], Decimal("2.50"))
        self.assertEqual(expected["receive_amount"], Decimal("4581.62"))
        self.assert_breakdown(order, expected, quote)
        self.assert_breakdown(self.detail(order), expected, quote)

    def test_fee_breakdown_express_and_home_source(self):
        cases = [("CNY", HOME, "2000.00", "express"), ("THB", "CNY", "12345.67", "express"),
                 ("USD", HOME, "321.09", "standard")]
        for source, target, amount, tier in cases:
            with self.subTest(source=source, tier=tier):
                if source != HOME:
                    self.fund_foreign(source, amount)
                quote = self.live_quote(source, target, amount, tier)
                order = self.create(quote)
                expected = self.expected_breakdown(self.corridor(source, target, tier), amount)
                self.assert_breakdown(order, expected, quote)
        # Hand-checked express CNY: fee 30+10=40, margin 1960*0.006 = 11.76, total 51.76.
        order = model("RemittanceOrder").objects.get(send_currency="CNY")
        self.assertEqual(D(self.detail(order)["total_cost"]), Decimal("51.76"))

    def assert_breakdown(self, order, expected, quote):
        self.assertEqual(D(order["send_amount"]), D(quote["quoted_amount"]))
        self.assertEqual(D(order["sender_fee"]), expected["sender_fee"])
        self.assertEqual(D(order["sender_fee"]), D(quote["sender_fee"]))
        self.assertEqual(D(order["rate"]), expected["rate"])
        self.assertEqual(D(order["mid_rate"]), expected["mid_rate"])
        self.assertEqual(D(order["fx_margin_cost"]), expected["fx_margin_cost"])
        self.assertEqual(D(order["total_cost"]), expected["total_cost"])
        self.assertEqual(D(order["total_cost"]), D(order["sender_fee"]) + D(order["fx_margin_cost"]))
        self.assertEqual(D(order["receive_amount"]), expected["receive_amount"])
        self.assertEqual(D(order["receive_amount"]), D(quote["net_received"]))

    def test_manual_quote_is_not_executable(self):
        self.fund_foreign("CNY", "1000.00")
        manual = self.quote("CNY", HOME, rate="9.9")
        self.create(manual, code=400, error="QUOTE_NOT_EXECUTABLE")
        corridor = self.corridor("CNY", HOME)
        with_corridor = self.quote("CNY", HOME, rate="9.9", corridor_id=str(corridor["id"]))
        self.create(with_corridor, code=400, error="QUOTE_NOT_EXECUTABLE")
        self.assertEqual(model("RemittanceOrder").objects.count(), 0)

    def test_consumed_quote_rejected(self):
        self.fund_foreign("CNY", "2000.00")
        quote = self.live_quote("CNY", HOME, "1000.00")
        self.convert(quote["id"], "1000.00")
        self.create(quote, code=400, error="QUOTE_CONSUMED")
        self.assertEqual(model("RemittanceOrder").objects.count(), 0)

    def test_expired_quote_rejected(self):
        quote = self.live_quote("CNY", HOME, "1000.00")
        self.expire(quote)
        self.create(quote, code=400, error="QUOTE_EXPIRED")
        self.assertEqual(model("RemittanceOrder").objects.count(), 0)

    def test_other_users_quote_rejected(self):
        quote = self.live_quote("CNY", HOME, "1000.00", user=self.other)
        response = self.call("remittance-orders", self.order_body(quote))
        self.assertIn(response.status_code, {400, 404}, str(response.data))
        self.assertEqual(model("RemittanceOrder").objects.count(), 0)

    def test_quote_held_by_order_blocks_second_order_conversion_and_receipt(self):
        self.fund_foreign("CNY", "2000.00")
        quote = self.live_quote("CNY", HOME, "1000.00")
        first = self.create(quote)
        self.create(quote, code=400, error="QUOTE_IN_USE")
        before = self.footprint()
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), "QUOTE_IN_USE")
        receipt = self.source("CNY", "1000.00")
        self.reject("funding-sources/" + receipt["id"] + "/receive", {"fx_quote_id": quote["id"]},
                    "QUOTE_IN_USE", operator=True)
        self.assertEqual(self.footprint(), before)
        # A cancelled order still holds its quote (one-to-one); the quote stays unusable.
        self.command(first, "cancel")
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), "QUOTE_IN_USE")
        self.create(quote, code=400, error="QUOTE_IN_USE")
        self.assertEqual(model("RemittanceOrder").objects.count(), 1)
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)

    def test_beneficiary_recipient_validation(self):
        self.fund_foreign("CNY", "1000.00")
        quote = self.live_quote("CNY", HOME, "1000.00")
        self.create(quote, recipient="BENEFICIARY", code=400)
        unverified = self.beneficiary(verified=False)
        self.create(quote, recipient="BENEFICIARY", beneficiary=unverified, code=400,
                    error="BENEFICIARY_NOT_VERIFIED")
        theirs = self.beneficiary(user=self.other)
        response = self.call("remittance-orders", self.order_body(quote, "BENEFICIARY", theirs))
        self.assertIn(response.status_code, {400, 404}, str(response.data))
        mine = self.beneficiary()
        self.create(quote, recipient="SELF", beneficiary=mine, code=400)
        self.create(quote, purpose="holiday", code=400)
        self.assertEqual(model("RemittanceOrder").objects.count(), 0)
        order = self.create(quote, recipient="BENEFICIARY", beneficiary=mine, purpose="tuition")
        self.assertEqual(order["recipient"], "BENEFICIARY")
        self.assertEqual(str(self.db(order).beneficiary_id), mine["id"])

    def test_create_rejected_when_corridor_disabled(self):
        quote = self.live_quote("CNY", HOME, "1000.00")
        model("Corridor").objects.filter(pk=quote["corridor_id"]).update(enabled=False)
        self.create(quote, code=400, error="CORRIDOR_DISABLED")

    # ================================================================ state machine
    def test_transition_matrix_from_every_status(self):
        for status in STATUSES:
            for action in ACTIONS:
                with self.subTest(status=status, action=action):
                    self.check_transition(status, action)

    def check_transition(self, status, action):
        order = self.drive(status)
        before = self.db(order)
        ledger, history = self.ledger_count(), self.history_rows(order)
        balances = self.footprint()["foreign"], self.home()
        response = self.command(order, action, version=before.version, code=None)
        after = self.db(order)
        key = (status, action)
        if key in ALLOWED:
            self.assertEqual(response.status_code, 201, str(response.data))
            self.assertEqual(after.status, ALLOWED[key])
            self.assertEqual(after.version, before.version + 1)
            self.assertEqual(self.history_rows(order), history + [(status, ALLOWED[key], before.version + 1)])
            self.assertEqual(response.data["data"]["status"], ALLOWED[key])
            return
        if key in REPLAY or (action == "submit" and status in SUBMIT_AFTER_SUBMISSION):
            if key in REPLAY:
                self.assertIn(response.status_code, {200, 201}, str(response.data))
            else:
                ok = response.status_code in {200, 201} or (
                    response.status_code == 400 and "INVALID_TRANSITION" in str(response.data))
                self.assertTrue(ok, (response.status_code, response.data))
            if response.status_code < 300:
                self.assertEqual(response.data["data"]["status"], status)
        else:
            self.assertEqual(response.status_code, 400, str(response.data))
            self.assertIn("INVALID_TRANSITION", str(response.data))
        self.assertEqual((after.status, after.version), (status, before.version))
        self.assertEqual(self.history_rows(order), history)
        self.assertEqual(self.ledger_count(), ledger)
        self.assertEqual((self.footprint()["foreign"], self.home()), balances)

    def test_expected_version_mismatch_is_409_for_every_command(self):
        created = self.drive("CREATED")
        for action in ("cancel", "submit"):
            with self.subTest(action=action):
                self.command(created, action, version=2, code=409)
        submitted = self.drive("SUBMITTED")
        for action in ADAPTER_OUTCOMES:
            with self.subTest(action=action):
                self.command(submitted, action, version=1, code=409)
        delivered = self.drive("DELIVERED")
        self.command(delivered, "reconcile", version=2, code=409)
        for order, status, version in ((created, "CREATED", 1), (submitted, "SUBMITTED", 2),
                                       (delivered, "DELIVERED", 3)):
            self.assertEqual((self.db(order).status, self.db(order).version), (status, version))
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))  # created order untouched
        self.assert_invariant()

    def test_adapter_event_is_operator_only(self):
        order = self.drive("SUBMITTED")
        for outcome in ADAPTER_OUTCOMES:
            with self.subTest(outcome=outcome):
                response = self.call("remittance-orders/" + order["id"] + "/adapter-event",
                                     {"outcome": outcome, "expected_version": 2})
                self.assertEqual(response.status_code, 403, str(response.data))
        self.assertEqual((self.db(order).status, self.db(order).version), ("SUBMITTED", 2))

    def test_student_commands_are_owner_only(self):
        order = self.drive("CREATED")
        for action in ("cancel", "submit", "reconcile"):
            with self.subTest(action=action, user="other"):
                response = self.command(order, action, version=1, code=None, user=self.other)
                self.assertIn(response.status_code, {403, 404}, str(response.data))
        response = self.get("remittance-orders/" + order["id"], user=self.other)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(items(self.get("remittance-orders", user=self.other).data), [])
        # The operator drives adapter callbacks only; reconcile/cancel/submit belong to the student.
        for action in ("cancel", "submit", "reconcile"):
            with self.subTest(action=action, user="operator"):
                response = self.command(order, action, version=1, code=None, user=self.operator)
                self.assertIn(response.status_code, {403, 404}, str(response.data))
        self.assertEqual((self.db(order).status, self.db(order).version), ("CREATED", 1))

    def test_adapter_replays_do_not_post_again(self):
        order = self.drive("SUBMITTED")
        delivered = self.adapter(order, "delivered", version=2)
        credit = self.legs(order)["credit"]
        home = self.home()
        # A duplicate callback carries the old expected_version; it must be acknowledged.
        replay = self.adapter(order, "delivered", version=2, code=None)
        self.assertIn(replay.status_code, {200, 201}, str(replay.data))
        self.assertEqual(replay.data["data"]["status"], "DELIVERED")
        self.assertEqual(replay.data["data"]["version"], delivered["version"])
        self.command(order, "reconcile")
        replay = self.adapter(order, "delivered", version=2, code=None)
        self.assertIn(replay.status_code, {200, 201}, str(replay.data))
        self.assertEqual(replay.data["data"]["status"], "RECONCILED")
        self.assertEqual(set(self.legs(order)), {"debit", "credit"})
        self.assertEqual(self.legs(order)["credit"].pk, credit.pk)
        self.assertEqual(self.home(), home)
        self.assertEqual(len(self.history_rows(order)), 4)
        self.assert_invariant()

    def test_idempotency_key_replay_of_adapter_event_returns_stored_response(self):
        order = self.drive("SUBMITTED")
        first = self.adapter(order, "failed", note="Bank rejected", key="cb-1")
        replay = self.call("remittance-orders/" + order["id"] + "/adapter-event",
                           {"outcome": "failed", "expected_version": 2, "note": "Bank rejected"},
                           operator=True, key="cb-1")
        self.assertEqual(replay.status_code, 200, str(replay.data))
        self.assertEqual(replay.data["data"], first)
        self.assertEqual(DemoLedgerEntry.objects.filter(remittance_order_id=order["id"],
                                                        remittance_leg="refund").count(), 1)

    # ================================================================ money
    def test_submit_debits_send_amount_from_source_and_consumes_quote(self):
        order, quote = self.new_order(amount="1000.00")
        self.fund_foreign("CNY", "250.00")
        state_version = self.version()
        data = self.submit(order, 1)
        self.assertEqual((data["status"], data["version"]), ("SUBMITTED", 2))
        self.assertEqual(self.foreign("CNY"), Decimal("250.00"))
        self.assertEqual(self.home(), OPENING)
        legs = self.legs(order)
        self.assertEqual(set(legs), {"debit"})
        self.assertEqual((legs["debit"].currency, legs["debit"].amount), ("CNY", Decimal("-1000.00")))
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        # Foreign movements stay out of the home cash-flow state.
        self.assertEqual(self.remittance_events(), {})
        self.assertEqual(self.version(), state_version)
        # The consumed quote can never be reused.
        self.reject("conversions", self.convert_body(quote["id"], "1000.00"), None)
        self.assert_invariant()

    def test_submit_insufficient_balance_leaves_no_trace(self):
        self.fund_foreign("CNY", "999.99")
        order, quote = self.new_order(amount="1000.00", fund=False)
        before = self.footprint()
        self.submit(order, 1, code=400, error="INSUFFICIENT_BALANCE")
        self.assertEqual(self.footprint(), before)
        self.assertEqual((self.db(order).status, self.db(order).version), ("CREATED", 1))
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        self.fund_foreign("CNY", "0.01")
        self.submit(order, 1)
        self.assertEqual(self.foreign("CNY"), Decimal("0.00"))
        self.assert_invariant()

    def test_home_source_reserve_required_and_debit_event(self):
        self.assertEqual((OPENING, RESERVE), (Decimal("80000.00"), Decimal("15000.00")))
        too_big, _ = self.new_order(HOME, amount="65000.01")
        before = self.footprint()
        self.submit(too_big, 1, code=400, error="RESERVE_REQUIRED")
        self.assertEqual(self.footprint(), before)
        over, _ = self.new_order(HOME, amount="80000.01")
        self.submit(over, 1, code=400, error="INSUFFICIENT_BALANCE")
        exact, _ = self.new_order(HOME, amount="65000.00")  # leaves exactly the reserve
        state_version = self.version()
        self.submit(exact, 1)
        self.assertEqual(self.home(), RESERVE)
        debit = self.legs(exact)["debit"]
        self.assertEqual((debit.currency, debit.amount), (HOME, Decimal("-65000.00")))
        events = self.remittance_events(exact)
        key = "remittance:%s:debit" % exact["id"]
        self.assertEqual(set(events), {key})
        self.assertEqual(events[key]["kind"], "expense")
        self.assertEqual(D(events[key]["amount"]), Decimal("65000.00"))
        self.assertEqual(events[key]["settled_sequence"], debit.sequence)
        self.assertEqual(events[key]["date"], debit.effective_on.isoformat())
        self.assertEqual(self.version(), state_version + 1)
        self.assert_invariant()

    def test_home_source_refund_event_and_target_credit(self):
        refunded = self.drive("SUBMITTED", source=HOME, amount="1000.00")
        self.adapter(refunded, "failed", note="Beneficiary bank closed")
        refund = self.legs(refunded)["refund"]
        self.assertEqual((refund.currency, refund.amount), (HOME, Decimal("1000.00")))
        events = self.remittance_events(refunded)
        self.assertEqual(set(events), {"remittance:%s:debit" % refunded["id"],
                                       "remittance:%s:refund" % refunded["id"]})
        event = events["remittance:%s:refund" % refunded["id"]]
        self.assertEqual((event["kind"], D(event["amount"]), event["settled_sequence"]),
                         ("income", Decimal("1000.00"), refund.sequence))
        self.assertEqual(self.home(), OPENING)
        # THB -> CNY delivered to SELF credits CNY, which is not a home-currency event.
        delivered = self.drive("DELIVERED", source=HOME, amount="2000.00")
        expected = price(self.corridor(HOME, "CNY"), "2000.00")["target"]
        self.assertEqual(self.foreign("CNY"), expected)
        self.assertEqual(set(self.remittance_events(delivered)), {"remittance:%s:debit" % delivered["id"]})
        self.assert_invariant()

    def test_self_delivery_credits_receive_amount_with_credit_event(self):
        order, quote = self.new_order(amount="1000.00")
        self.submit(order)
        self.adapter(order, "dispatched")
        data = self.adapter(order, "delivered")
        self.assertEqual(data["status"], "DELIVERED")
        legs = self.legs(order)
        self.assertEqual(set(legs), {"debit", "credit"})
        self.assertEqual((legs["credit"].currency, legs["credit"].amount), (HOME, D(quote["net_received"])))
        self.assertEqual(self.home(), OPENING + D(quote["net_received"]))
        self.assertEqual(self.foreign("CNY"), Decimal("0.00"))
        key = "remittance:%s:credit" % order["id"]
        event = self.remittance_events(order)[key]
        self.assertEqual((event["kind"], D(event["amount"]), event["settled_sequence"]),
                         ("income", D(quote["net_received"]), legs["credit"].sequence))
        self.assert_invariant()

    def test_beneficiary_delivery_does_not_touch_wallet(self):
        payee = self.beneficiary()
        order, _ = self.new_order(amount="1000.00", recipient="BENEFICIARY", beneficiary=payee,
                                  purpose="tuition")
        self.submit(order)
        footprint = self.footprint()
        data = self.adapter(order, "delivered")
        self.assertEqual(data["status"], "DELIVERED")
        self.assertEqual(self.footprint(), footprint)
        self.assertEqual(set(self.legs(order)), {"debit"})
        data = self.command(order, "reconcile")
        self.assertEqual(data["status"], "RECONCILED")
        self.assert_invariant()

    def test_failed_refunds_full_send_amount_with_reason(self):
        for start in ("SUBMITTED", "IN_TRANSIT", "UNKNOWN"):
            with self.subTest(start=start):
                held = self.foreign("CNY")
                order = self.drive(start, amount="1000.00")
                self.assertEqual(self.foreign("CNY"), held)
                data = self.adapter(order, "failed", note="Simulated rail failure")
                self.assertEqual(data["status"], "REFUNDED")
                self.assertEqual(data["failure_reason"], "Simulated rail failure")
                self.assertEqual(self.db(order).failure_reason, "Simulated rail failure")
                refund = self.legs(order)["refund"]
                self.assertEqual((refund.currency, refund.amount), ("CNY", Decimal("1000.00")))
                self.assertEqual(self.foreign("CNY"), held + Decimal("1000.00"))
        self.assert_invariant()

    def test_failed_without_note_still_records_a_reason(self):
        order = self.drive("SUBMITTED")
        data = self.adapter(order, "failed")
        self.assertTrue(data["failure_reason"])

    def test_unknown_then_delivered_or_failed(self):
        delivered = self.drive("UNKNOWN")
        self.adapter(delivered, "delivered")
        self.assertEqual(self.db(delivered).status, "DELIVERED")
        self.assertEqual(set(self.legs(delivered)), {"debit", "credit"})
        failed = self.drive("UNKNOWN")
        self.adapter(failed, "failed", note="Rail confirmed failure")
        self.assertEqual(self.db(failed).status, "REFUNDED")
        self.assertEqual(set(self.legs(failed)), {"debit", "refund"})
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assert_invariant()

    def test_reconcile_after_delivery_only(self):
        order = self.drive("SUBMITTED")
        self.command(order, "reconcile", code=400, error="INVALID_TRANSITION")
        self.adapter(order, "delivered")
        data = self.command(order, "reconcile", note="Matched bank statement")
        self.assertEqual((data["status"], data["version"]), ("RECONCILED", 4))
        self.assertEqual(self.history_rows(order)[-1], ("DELIVERED", "RECONCILED", 4))
        # Reconcile changes no balances.
        self.assertEqual(set(self.legs(order)), {"debit", "credit"})
        self.assert_invariant()

    # ================================================================ submit rechecks
    def test_submit_rechecks_corridor_enabled(self):
        order, quote = self.new_order()
        corridor = model("Corridor").objects.get(pk=quote["corridor_id"])
        corridor.enabled = False
        corridor.save()
        before = self.footprint()
        self.submit(order, 1, code=400, error="CORRIDOR_DISABLED")
        self.assertEqual(self.footprint(), before)
        self.assertEqual(self.db(order).status, "CREATED")

    def test_submit_rechecks_corridor_amount_range(self):
        for low, high in (("100", "999.99"), ("1000.01", "50000")):
            with self.subTest(low=low, high=high):
                order, quote = self.new_order(amount="1000.00")
                model("Corridor").objects.filter(pk=quote["corridor_id"]).update(
                    min_amount=D(low), max_amount=D(high))
                before = self.footprint()
                self.submit(order, 1, code=400, error="CORRIDOR_AMOUNT_OUT_OF_RANGE")
                self.assertEqual(self.footprint(), before)
                model("Corridor").objects.filter(pk=quote["corridor_id"]).update(
                    min_amount=Decimal("100"), max_amount=Decimal("50000"))
                self.submit(order, 1)

    def test_submit_rechecks_beneficiary_still_verified(self):
        payee = self.beneficiary()
        order, _ = self.new_order(recipient="BENEFICIARY", beneficiary=payee, purpose="family_support")
        self.verify_beneficiary(payee, False)
        before = self.footprint()
        self.submit(order, 1, code=400, error="BENEFICIARY_NOT_VERIFIED")
        self.assertEqual(self.footprint(), before)
        self.verify_beneficiary(payee, True)
        self.submit(order, 1)
        self.assertEqual(self.db(order).status, "SUBMITTED")

    # ================================================================ expiry / cancel
    def test_submit_after_quote_expiry_persists_expired_without_debit(self):
        order, quote = self.new_order()
        self.expire(quote)
        before = self.footprint()
        response = self.submit(order, 1, code=None)
        self.assertIn(response.status_code, {200, 201}, str(response.data))
        self.assertEqual(response.data["data"]["status"], "EXPIRED")
        self.assertEqual(self.footprint(), before)
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        row = self.db(order)
        self.assertEqual((row.status, row.version), ("EXPIRED", 2))
        self.assertEqual(self.history_rows(order), [("", "CREATED", 1), ("CREATED", "EXPIRED", 2)])
        self.submit(order, 2, code=400, error="INVALID_TRANSITION")
        self.assertEqual(self.legs(order), {})

    def test_expiry_via_patched_clock(self):
        from unittest.mock import patch
        order, quote = self.new_order()
        later = timezone.now() + timedelta(minutes=11)  # live quotes expire after 10 minutes
        with patch("django.utils.timezone.now", return_value=later):
            response = self.submit(order, 1, code=None)
        self.assertIn(response.status_code, {200, 201}, str(response.data))
        self.assertEqual(self.db(order).status, "EXPIRED")
        self.assertEqual(self.legs(order), {})
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))

    def test_any_command_on_expired_created_order_persists_expired(self):
        # docs: "过期 ... 任何对该订单的命令触发" (cancel, reconcile and adapter callbacks too).
        for action in ("cancel", "reconcile", "dispatched", "delivered"):
            with self.subTest(action=action):
                order, quote = self.new_order()
                self.expire(quote)
                self.command(order, action, version=1, code=None)
                self.assertEqual(self.db(order).status, "EXPIRED")
                self.assertEqual(self.legs(order), {})

    def test_cancel_created_order(self):
        order, quote = self.new_order()
        data = self.command(order, "cancel", note="Changed my mind")
        self.assertEqual((data["status"], data["version"]), ("CANCELLED", 2))
        self.assertEqual(self.history_rows(order), [("", "CREATED", 1), ("CREATED", "CANCELLED", 2)])
        self.assertEqual(self.legs(order), {})
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertIsNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        self.submit(order, 2, code=400, error="INVALID_TRANSITION")

    # ================================================================ history / audit
    def test_status_history_one_event_per_transition(self):
        order = self.drive("SUBMITTED")
        self.adapter(order, "dispatched", note="Rail accepted")
        self.adapter(order, "unknown", note="Timeout")
        self.adapter(order, "delivered", note="Confirmed")
        self.command(order, "reconcile")
        expected = [("", "CREATED", 1), ("CREATED", "SUBMITTED", 2), ("SUBMITTED", "IN_TRANSIT", 3),
                    ("IN_TRANSIT", "UNKNOWN", 4), ("UNKNOWN", "DELIVERED", 5), ("DELIVERED", "RECONCILED", 6)]
        self.assertEqual(self.history_rows(order), expected)
        detail = self.detail(order)
        self.assertEqual([(h["from"], h["to"], h["version"]) for h in detail["history"]], expected)
        self.assertEqual(detail["version"], 6)
        notes = {h["to"]: h["note"] for h in detail["history"]}
        self.assertEqual(notes["IN_TRANSIT"], "Rail accepted")
        self.assertEqual(notes["UNKNOWN"], "Timeout")
        actors = {h["to"]: h["actor_id"] for h in detail["history"]}
        self.assertEqual(actors["SUBMITTED"], self.user.pk)
        self.assertEqual(actors["IN_TRANSIT"], self.operator.pk)
        self.assertEqual(actors["RECONCILED"], self.user.pk)
        self.assertTrue(all(h["at"] for h in detail["history"]))
        audits = AuditEvent.objects.filter(owner=self.user, entity_id=order["id"]).count()
        self.assertGreaterEqual(audits, len(expected))

    def test_status_history_is_append_only(self):
        if connection.vendor != "postgresql":
            self.skipTest("Immutability triggers are PostgreSQL-only")
        order = self.drive("SUBMITTED")
        events = model("RemittanceStatusEvent").objects.filter(order_id=order["id"])
        with self.assertRaises(DatabaseError), transaction.atomic():
            events.filter(version=2).update(note="rewritten")
        with self.assertRaises(DatabaseError), transaction.atomic():
            events.filter(version=1).delete()
        self.assertEqual(self.history_rows(order), [("", "CREATED", 1), ("CREATED", "SUBMITTED", 2)])
        with self.assertRaises(IntegrityError), transaction.atomic():
            model("RemittanceStatusEvent").objects.create(
                owner=self.user, order_id=order["id"], from_status="SUBMITTED", to_status="IN_TRANSIT",
                actor=self.user, version=2)

    # ================================================================ invariants / constraints
    def test_mixed_sequence_keeps_ledger_invariant(self):
        self.receive_home("9000.00")
        self.assert_invariant()
        delivered = self.drive("DELIVERED", amount="1500.00")
        self.assert_invariant()
        refunded = self.drive("REFUNDED", source=HOME, amount="5000.00")
        self.assert_invariant()
        payee = self.beneficiary()
        to_payee, _ = self.new_order(HOME, "CNY", "3000.00", recipient="BENEFICIARY", beneficiary=payee)
        self.submit(to_payee)
        self.adapter(to_payee, "delivered")
        self.assert_invariant()
        self.fund_foreign("CNY", "500.00")
        self.convert_live("CNY", HOME, "500.00")
        cancelled = self.drive("CANCELLED", amount="700.00")
        unknown = self.drive("UNKNOWN", amount="800.00")
        self.adapter(unknown, "delivered")
        expired = self.drive("EXPIRED", amount="900.00")
        self.command(delivered, "reconcile")
        self.assert_invariant()
        for order in model("RemittanceOrder").objects.filter(owner=self.user):
            legs = self.legs(order)
            expected = {"CREATED": set(), "CANCELLED": set(), "EXPIRED": set(), "SUBMITTED": {"debit"},
                        "REFUNDED": {"debit", "refund"},
                        "DELIVERED": {"debit", "credit"} if order.recipient == "SELF" else {"debit"},
                        "RECONCILED": {"debit", "credit"} if order.recipient == "SELF" else {"debit"}}
            self.assertEqual(set(legs), expected[order.status], order.status)
            if "debit" in legs:
                self.assertEqual((legs["debit"].currency, legs["debit"].amount),
                                 (order.send_currency, -order.send_amount))
            if "refund" in legs:
                self.assertEqual((legs["refund"].currency, legs["refund"].amount),
                                 (order.send_currency, order.send_amount))
            if "credit" in legs:
                self.assertEqual((legs["credit"].currency, legs["credit"].amount),
                                 (order.receive_currency, order.receive_amount))
        self.assertEqual({o.status for o in model("RemittanceOrder").objects.filter(
            pk__in=[cancelled["id"], expired["id"], refunded["id"]])}, {"CANCELLED", "EXPIRED", "REFUNDED"})

    def test_database_allows_one_leg_per_kind_per_order(self):
        order = self.drive("SUBMITTED")
        debit = self.legs(order)["debit"]
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            DemoLedgerEntry.objects.create(
                owner=self.user, remittance_order_id=order["id"], remittance_leg="debit", currency="CNY",
                amount=Decimal("-1.00"), sequence=debit.sequence + 100, effective_on=debit.effective_on)
        self.assertIn("ledger_remittance_leg_unique", str(caught.exception))

    def test_database_enforces_leg_pairing_and_sign(self):
        order = self.drive("SUBMITTED")
        debit = self.legs(order)["debit"]
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            DemoLedgerEntry.objects.create(
                owner=self.user, remittance_order_id=order["id"], remittance_leg=None, currency="CNY",
                amount=Decimal("-1.00"), sequence=debit.sequence + 100, effective_on=debit.effective_on)
        self.assertIn("ledger_remittance_leg_pairing", str(caught.exception))
        self.fund_foreign("CNY", "500.00")
        conversion = self.convert_live("CNY", HOME, "500.00")
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            DemoLedgerEntry.objects.create(
                owner=self.user, conversion_id=conversion["id"], remittance_leg="credit", currency="USD",
                amount=Decimal("1.00"), sequence=debit.sequence + 101, effective_on=debit.effective_on)
        self.assertIn("ledger_remittance_leg_pairing", str(caught.exception))
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            DemoLedgerEntry.objects.create(
                owner=self.user, remittance_order_id=order["id"], remittance_leg="refund", currency="CNY",
                amount=Decimal("-1.00"), sequence=debit.sequence + 102, effective_on=debit.effective_on)
        self.assertIn("ledger_origin_and_sign", str(caught.exception))

    def test_database_enforces_recipient_consistency(self):
        order = self.drive("CREATED")
        payee = self.beneficiary()
        with self.assertRaises(IntegrityError) as caught, transaction.atomic():
            model("RemittanceOrder").objects.filter(pk=order["id"]).update(beneficiary_id=payee["id"])
        self.assertIn("remittance_recipient_consistent", str(caught.exception))

    def test_user_cannot_write_remittance_events_via_state(self):
        def save(snapshot):
            state = self.state()
            self.client.force_authenticate(self.user)
            return self.client.post("/api/v2/state/", {"expected_version": state.version, "snapshot": snapshot},
                                    format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        forged = deepcopy(self.state().snapshot)
        forged["events"].append({"id": "remittance:%s:refund" % uuid4(), "label": "Forged refund",
                                 "kind": "income", "amount": "50000.00", "date": "2026-10-03",
                                 "certainty": "confirmed"})
        version = self.version()
        response = save(forged)
        self.assertEqual(response.status_code, 400, str(response.data))
        self.assertEqual(self.version(), version)
        # Real ledger events cannot be edited or dropped either.
        order = self.drive("SUBMITTED", source=HOME, amount="1000.00")
        key = "remittance:%s:debit" % order["id"]
        edited = deepcopy(self.state().snapshot)
        for event in edited["events"]:
            if event["id"] == key:
                event["amount"] = "1.00"
        self.assertEqual(save(edited).status_code, 400)
        dropped = deepcopy(self.state().snapshot)
        dropped["events"] = [e for e in dropped["events"] if e["id"] != key]
        self.assertEqual(save(dropped).status_code, 400)
        self.assertIn(key, self.remittance_events(order))

    # ================================================================ review queue
    @override_settings(STUDYFLOW_READINESS_ENABLED=True)
    def test_review_queue_tracks_refunded_and_unknown_orders(self):
        def queue():
            response = self.get("review-queue", {"kind": "remittance"})
            self.assertEqual(response.status_code, 200, str(response.data))
            return {item["entity_id"]: item for item in response.data["data"]["items"]}

        refunded = self.drive("REFUNDED")
        unknown = self.drive("UNKNOWN")
        healthy = self.drive("DELIVERED")
        found = queue()
        self.assertEqual(set(found), {refunded["id"], unknown["id"]})
        self.assertNotIn(healthy["id"], found)
        self.assertTrue(all(item["status"] != "RESOLVED" for item in found.values()))
        self.assertEqual(found[unknown["id"]]["details"]["status"], "UNKNOWN")
        self.assertEqual(found[refunded["id"]]["details"]["status"], "REFUNDED")
        self.adapter(unknown, "delivered")
        found = queue()
        self.assertEqual(found[unknown["id"]]["status"], "RESOLVED")
        self.assertNotEqual(found[refunded["id"]]["status"], "RESOLVED")

    # ================================================================ credit evidence
    def set_clock(self, value):
        self.post("demo/clock", {"date": value})

    def credit_profile(self):
        response = self.get("credit/profile")
        self.assertEqual(response.status_code, 200, str(response.data))
        return response.data["data"]

    def wallet_clock(self):
        return DemoWallet.objects.get(owner=self.user).clock

    def test_credit_profile_counts_delivered_beneficiary_orders_by_deadline(self):
        # docs/credit.md: as_of is the real today; completed records dated after it (demo clock
        # ahead of real time) still count. Start the demo clock no earlier than today so the
        # test does not depend on when it runs.
        today = timezone.localdate()
        base = max(today, self.wallet_clock())
        if base > self.wallet_clock():
            self.set_clock(base.isoformat())
        day = lambda n: (base + timedelta(days=n)).isoformat()
        payee = self.beneficiary()
        out = {"recipient": "BENEFICIARY", "beneficiary": payee, "purpose": "tuition"}
        on_time, _ = self.new_order(amount="1000.00", deadline=day(3), **out)
        late, _ = self.new_order(amount="1000.00", deadline=day(3), **out)
        boundary, _ = self.new_order(amount="1000.00", deadline=day(2), **out)
        no_deadline, _ = self.new_order(amount="1000.00", **out)
        undelivered, _ = self.new_order(amount="1000.00", deadline=day(1), **out)
        refunded, _ = self.new_order(amount="1000.00", deadline=day(1), **out)
        # SELF orders never count, even when delivered on time (docs/remittance.md 联动).
        self_on_time, _ = self.new_order(amount="1000.00", deadline=day(3))
        self_late, _ = self.new_order(amount="1000.00", deadline=day(1))
        orders = (on_time, late, boundary, no_deadline, undelivered, refunded, self_on_time, self_late)
        for order in orders:
            self.submit(order)
        self.adapter(refunded, "failed")
        self.set_clock(day(2))
        for order in (boundary, on_time, no_deadline, self_on_time, self_late):
            self.adapter(order, "delivered")         # boundary: delivered_on == deadline -> on time
        self.set_clock(day(4))
        self.adapter(late, "delivered")
        self.command(on_time, "reconcile")           # reconciled still counts as delivered
        self.assertEqual(self.db(on_time).delivered_on.isoformat(), day(2))
        self.assertEqual(self.db(late).delivered_on.isoformat(), day(4))
        self.assertIs(self.detail(on_time)["on_time"], True)
        self.assertIs(self.detail(boundary)["on_time"], True)
        self.assertIs(self.detail(late)["on_time"], False)
        self.assertIs(self.detail(self_on_time)["on_time"], True)
        self.assertIsNone(self.detail(no_deadline)["on_time"])
        data = self.credit_profile()
        self.assertEqual(data["as_of"], today.isoformat())
        evidence = {e["id"]: e for e in data["evidence"] if e["source"] == "remittance_order"}
        self.assertEqual(set(evidence), {on_time["id"], late["id"], boundary["id"]})
        self.assertNotIn(self_on_time["id"], evidence)
        self.assertNotIn(self_late["id"], evidence)
        self.assertEqual(evidence[on_time["id"]]["status"], "ON_TIME")
        self.assertEqual(evidence[boundary["id"]]["status"], "ON_TIME")
        self.assertEqual(evidence[late["id"]]["status"], "LATE")
        self.assertEqual(evidence[late["id"]]["due_on"], day(3))
        self.assertEqual(evidence[late["id"]]["completed_on"], day(4))
        self.assertEqual((data["on_time"], data["late"], data["overdue"]), (2, 1, 0))
        # The window follows real time: pushing the demo clock a year ahead ages nothing out.
        self.set_clock(day(400))
        again = self.credit_profile()
        self.assertEqual(again["as_of"], today.isoformat())
        self.assertEqual((again["on_time"], again["late"], again["overdue"]), (2, 1, 0))

    def test_self_orders_alone_never_build_credit(self):
        # Regression: six cheap on-time self-transfers used to lift the level to GOOD.
        base = self.wallet_clock()
        orders = [self.new_order(amount="100.00", deadline=(base + timedelta(days=1)).isoformat())[0]
                  for _ in range(6)]
        for order in orders:
            self.submit(order)
            self.adapter(order, "delivered")
        self.assertTrue(all(self.detail(o)["on_time"] for o in orders))
        data = self.credit_profile()
        self.assertEqual([e for e in data["evidence"] if e["source"] == "remittance_order"], [])
        self.assertEqual((data["level"], data["on_time"]), ("BUILDING", 0))

    # ================================================================ deadline range
    def test_deadline_must_be_between_clock_and_366_days_later(self):
        clock = self.wallet_clock()
        day = lambda n: (clock + timedelta(days=n)).isoformat()
        for offset, ok in ((-1, False), (0, True), (366, True), (367, False), (-400, False)):
            with self.subTest(offset=offset):
                quote = self.live_quote("CNY", HOME, "1000.00")
                if ok:
                    order = self.create(quote, deadline=day(offset))
                    self.assertEqual(order["deadline"], day(offset))
                else:
                    self.create(quote, deadline=day(offset), code=400, error="DEADLINE_OUT_OF_RANGE")
                    # A rejected create holds nothing: the same quote still works without a deadline.
                    self.assertFalse(model("RemittanceOrder").objects.filter(quote_id=quote["id"]).exists())
                    self.assertIsNone(self.create(quote)["deadline"])
        # The range follows the demo clock.
        self.set_clock(day(30))
        moved = self.wallet_clock()
        self.create(self.live_quote("CNY", HOME, "1000.00"), deadline=day(29), code=400,
                    error="DEADLINE_OUT_OF_RANGE")
        self.create(self.live_quote("CNY", HOME, "1000.00"), deadline=moved.isoformat())
        self.create(self.live_quote("CNY", HOME, "1000.00"),
                    deadline=(moved + timedelta(days=366)).isoformat())
        self.create(self.live_quote("CNY", HOME, "1000.00"),
                    deadline=(moved + timedelta(days=367)).isoformat(), code=400,
                    error="DEADLINE_OUT_OF_RANGE")

    # ================================================================ separation of duties (T3)
    T3_CNY = "12000.00"  # above the CNY per-transaction limit of 10,000 (credit multiplier 1.0)

    def request_approval(self, order):
        return self.post("approvals", {"action": "remittance.submit", "target_id": order["id"],
                                       "amount": self.T3_CNY, "currency": "CNY",
                                       "reason": "Semester tuition"})

    def decide(self, approval, staff, decision="approve", code=200, error=None):
        version = model("ApprovalRequest").objects.get(pk=approval["id"]).version
        response = self.call("approvals/" + approval["id"] + "/decide",
                             {"decision": decision, "note": "Reviewed", "expected_version": version},
                             user=staff)
        self.assertEqual(response.status_code, code, str(response.data))
        if error:
            self.assertIn(error, str(response.data))
        return response

    def test_beneficiary_verifier_cannot_decide_remittance_approval(self):
        payee = self.beneficiary()  # verified by self.operator
        order, _ = self.new_order(amount=self.T3_CNY, recipient="BENEFICIARY", beneficiary=payee,
                                  purpose="tuition")
        approval = self.request_approval(order)
        for decision in ("approve", "reject"):
            with self.subTest(decision=decision):
                self.decide(approval, self.operator, decision, code=403, error="SEPARATION_OF_DUTIES")
        row = model("ApprovalRequest").objects.get(pk=approval["id"])
        self.assertEqual((row.status, row.version, row.decided_by_id), ("PENDING", 1, None))
        # Only the most recent verifier is excluded: after a second operator re-verifies,
        # the roles swap.
        self.post("beneficiaries/" + payee["id"] + "/verify", {"verified": True}, user=self.approver)
        self.decide(approval, self.approver, "approve", code=403, error="SEPARATION_OF_DUTIES")
        self.decide(approval, self.operator, "approve")
        self.assertEqual(model("ApprovalRequest").objects.get(pk=approval["id"]).status, "APPROVED")
        self.submit(order)
        self.assertEqual(self.db(order).status, "SUBMITTED")
        self.assertEqual(model("ApprovalRequest").objects.get(pk=approval["id"]).status, "USED")
        self.assert_invariant()

    def test_self_order_approval_is_not_bound_to_beneficiary_verifier(self):
        self.beneficiary()  # self.operator has verified a beneficiary of this student
        order, _ = self.new_order(amount=self.T3_CNY)
        approval = self.request_approval(order)
        self.decide(approval, self.operator, "approve")
        self.submit(order)
        self.assertEqual(self.db(order).status, "SUBMITTED")
        self.assertEqual(model("ApprovalRequest").objects.get(pk=approval["id"]).status, "USED")
        rejected_order, _ = self.new_order(amount=self.T3_CNY)
        rejected = self.request_approval(rejected_order)
        self.decide(rejected, self.operator, "reject")
        self.assertEqual(model("ApprovalRequest").objects.get(pk=rejected["id"]).status, "REJECTED")

    # ================================================================ live FX mode
    def frankfurter(self, rates, calls):
        """FxAdapter factory whose fetch never touches the network (records every URL)."""
        from finance import fx_rates
        real = fx_rates.FxAdapter

        def fetch(url):
            calls.append(url)
            parts = urlsplit(url)
            base, quote = parts.path.rstrip("/").split("/")[-2:]
            if (base, quote) not in rates:
                raise OSError("network disabled in tests")
            return {"base": base, "quote": quote, "rate": rates[(base, quote)],
                    "date": parse_qs(parts.query)["date"][0], "providers": ["ECB"]}
        return patch("finance.fx_rates.FxAdapter", lambda *args, **kwargs: real(fetch_json=fetch))

    def test_live_mode_rejects_fixture_priced_quotes(self):
        self.fund_foreign("CNY", "2000.00")
        fixture_quote = self.live_quote("CNY", HOME, "1000.00")
        self.assertEqual(FXQuote.objects.get(pk=fixture_quote["id"]).rate_source, "fixture")
        calls = []
        with override_settings(STUDYFLOW_FX_LIVE=True), \
                self.frankfurter({("CNY", HOME): Decimal("4.70")}, calls):
            self.create(fixture_quote, code=400, error="QUOTE_NOT_EXECUTABLE")
            self.reject("conversions", self.convert_body(fixture_quote["id"], "1000.00"), "QUOTE_NOT_EXECUTABLE")
            self.assertEqual(model("RemittanceOrder").objects.count(), 0)
            live = self.live_quote("CNY", HOME, "1000.00")
            row = FXQuote.objects.get(pk=live["id"])
            self.assertEqual(row.rate_source, "frankfurter")
            self.assertEqual(row.mid_rate, Decimal("4.70"))  # not the 4.60 fixture snapshot
            order = self.create(live)
            self.assertEqual(D(order["mid_rate"]), Decimal("4.70"))
            self.assertEqual(D(order["receive_amount"]), D(live["net_received"]))
            self.submit(order)
            self.assertEqual(self.db(order).status, "SUBMITTED")
        self.assertTrue(calls)
        self.assertTrue(all(url.startswith("https://api.frankfurter.dev/") for url in calls))
        self.assertIsNone(FXQuote.objects.get(pk=fixture_quote["id"]).consumed_at)
        self.assert_invariant()

    def test_live_mode_ignores_fixture_snapshots(self):
        self.fund_foreign("CNY", "1000.00")
        self.live_quote("CNY", HOME, "1000.00")  # leaves a fresh fixture snapshot behind
        self.assertTrue(model("FxRateSnapshot").objects.filter(base="CNY", quote=HOME, source="fixture").exists())
        calls = []
        with override_settings(STUDYFLOW_FX_LIVE=True), self.frankfurter({}, calls):
            response = self.call("fx-quotes/live", {"corridor_id": str(self.corridor("CNY", HOME)["id"]),
                                                    "send_amount": "1000.00"})
            self.assertEqual(response.status_code, 503, str(response.data))
            self.assertIn("FX_RATE_UNAVAILABLE", str(response.data))
            self.assertIsNone(self.balance_row("CNY")["valuation"])
        self.assertTrue(calls, "live mode must fetch instead of reusing the fixture snapshot")
        self.assertEqual(FXQuote.objects.filter(owner=self.user, rate_source="frankfurter").count(), 0)
