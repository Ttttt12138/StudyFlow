"""PostgreSQL concurrency and migration tests for docs/multi-currency.md."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from auto_test.test_multicurrency import FX_SETTINGS, HOME, PASSWORD, MultiCurrencyHarness, model
from finance.policy_flow import client_flow, step_up_header
from finance.workflow_models import FXQuote, IdempotencyRecord

BEFORE = ("finance", "0014_copilot_workflows")
AFTER = ("finance", "0015_multicurrency")


@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL locking")
@override_settings(**FX_SETTINGS)
class MultiCurrencyConcurrencyTests(MultiCurrencyHarness, TransactionTestCase):
    username = "mc-parallel"

    def setUp(self):
        self.client = APIClient()
        self.bootstrap()

    def race(self, bodies, keys=None, path="conversions", actor=None):
        """POST bodies[i] concurrently; returns [(status, data)] in index order."""
        paths = path if isinstance(path, list) else [path] * len(bodies)
        keys = keys or [str(uuid4()) for _ in bodies]
        barrier = Barrier(len(bodies))
        actor_id = (actor or self.user).pk
        # Step-up (and T3 approval) is done up front so the race itself is between the commands.
        headers = [{} if (actor or self.user).is_staff else step_up_header(
            client_flow(actor or self.user, PASSWORD, self.approver), paths[i], bodies[i])
            for i in range(len(bodies))]

        def work(index):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=actor_id))
                barrier.wait(timeout=10)
                response = client.post("/api/v2/" + paths[index] + "/", bodies[index], format="json",
                                       HTTP_IDEMPOTENCY_KEY=keys[index], **headers[index])
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(bodies)) as pool:
            return list(pool.map(work, range(len(bodies))))

    def test_same_quote_converted_concurrently_has_one_effect(self):
        self.hold("CNY", "2000.00")
        quote = self.live("CNY", HOME, "1000.00")
        version = self.version()
        body = self.convert_body(quote["id"], "1000.00", version=version)
        results = self.race([body, body])
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses[0], 201, results)
        # Loser fails on the consumed quote or the bumped state version; the spec does not order them.
        self.assertIn(statuses[1], {400, 409}, results)
        self.assertEqual(model("CurrencyConversion").objects.filter(quote_id=quote["id"]).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertEqual(self.home(), Decimal("80000.00") + Decimal("4581.62"))
        self.assertEqual(self.version(), version + 1)
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        self.assert_invariant()

    def test_same_quote_concurrent_receipts_consume_once(self):
        # receive/ takes no state_version, so the only guard here is single-use of the quote.
        quote = self.quote("CNY", HOME, rate="5")
        sources = [self.source("CNY", "100.00") for _ in range(2)]
        paths = ["funding-sources/" + s["id"] + "/receive" for s in sources]
        results = self.race([{"fx_quote_id": quote["id"]}] * 2, path=paths, actor=self.operator)
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses, [201, 400], results)
        loser = next(data for status, data in results if status == 400)
        self.assertIn("QUOTE_CONSUMED", str(loser))
        self.assertEqual(self.home(), Decimal("80500.00"))
        self.assertEqual(sum(model("FundingSource").objects.get(pk=s["id"]).received for s in sources), 1)
        self.assert_invariant()

    def test_competing_quotes_cannot_overdraw_foreign_balance(self):
        self.hold("CNY", "1000.00")
        bodies = [self.convert_body(self.live("CNY", HOME, "800.00")["id"], "800.00") for _ in range(2)]
        results = self.race(bodies)
        statuses = sorted(status for status, _ in results)
        self.assertEqual(statuses[0], 201, results)
        self.assertIn(statuses[1], {400, 409}, results)
        self.assertEqual(self.foreign("CNY"), Decimal("200.00"))
        self.assertEqual(FXQuote.objects.filter(owner=self.user, consumed_at__isnull=False).count(), 1)
        self.assert_invariant()

    def test_many_competing_conversions_never_go_negative(self):
        self.hold("CNY", "1000.00")
        bodies = [self.convert_body(self.live("CNY", HOME, "300.00")["id"], "300.00") for _ in range(4)]
        results = self.race(bodies)
        wins = sum(status == 201 for status, _ in results)
        self.assertTrue(all(status in {201, 400, 409} for status, _ in results), results)
        self.assertGreaterEqual(wins, 1)
        self.assertLessEqual(wins, 3)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00") - Decimal("300.00") * wins)
        self.assertEqual(model("CurrencyConversion").objects.count(), wins)
        self.assert_invariant()

    def test_same_idempotency_key_concurrent_conversion_posts_once(self):
        self.hold("CNY", "1000.00")
        quote = self.live("CNY", HOME, "500.00")
        body = self.convert_body(quote["id"], "500.00")
        results = self.race([body, body], keys=["same-convert", "same-convert"])
        self.assertEqual(sorted(status for status, _ in results), [200, 201], results)
        self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(model("CurrencyConversion").objects.count(), 1)
        self.assertEqual(IdempotencyRecord.objects.filter(owner=self.user, key="same-convert").count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("500.00"))
        self.assert_invariant()

    def test_conversion_and_payment_submit_cannot_both_spend_reserve(self):
        self.receive_home("9000.00")  # balance 89000, reserve 15000
        payment = self.pending_payment("rent", submit=False)
        quote = self.live(HOME, "CNY", "70000.00")
        # Either alone fits above the reserve; together they do not.
        bodies = [self.convert_body(quote["id"], "70000.00"), {}]
        results = self.race(bodies, path=["conversions", "payments/" + payment["id"] + "/submit"])
        statuses = [status for status, _ in results]
        self.assertEqual(sorted(statuses)[0], 201, results)
        self.assertIn(sorted(statuses)[1], {400, 409}, results)
        pending = Decimal("9000.00") if statuses[1] == 201 else Decimal("0")
        self.assertGreaterEqual(self.home() - pending, Decimal("15000.00"))
        self.assert_invariant()


@skipUnless(connection.vendor == "postgresql", "Isolated PostgreSQL migration schema")
class MultiCurrencyMigrationTests(TransactionTestCase):
    def in_schema(self, body):
        schema = "migration_test_" + uuid4().hex
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            cursor.execute(f'SET search_path TO "{schema}"')
        try:
            body()
        finally:
            with connection.cursor() as cursor:
                cursor.execute("SET search_path TO public")
                cursor.execute(f'DROP SCHEMA "{schema}" CASCADE')

    def legacy_wallet(self, apps):
        """Wallet with a +9000 funding credit and a -500 payment debit (old schema shape)."""
        get = lambda name: apps.get_model("finance", name)
        user = apps.get_model("auth", "User").objects.create(username="legacy-wallet-" + uuid4().hex[:6])
        snapshot = {"currency": "THB", "as_of": "2026-10-02", "opening_balance": "80000.00",
                    "reserve": "15000.00", "events": [
                        {"id": "rent", "label": "Rent", "kind": "expense", "amount": "500.00",
                         "date": "2026-10-05", "certainty": "confirmed"}]}
        state = get("FinancialState").objects.create(owner_id=user.pk, version=1, snapshot=snapshot)
        wallet = get("DemoWallet").objects.create(owner_id=user.pk, initial_state=state,
                                                  balance=Decimal("88500.00"), clock="2026-10-02")
        source = get("FundingSource").objects.create(
            owner_id=user.pk, economic_key="legacy-savings", kind="external_savings", currency="THB",
            amount=Decimal("9000.00"), available_on="2026-10-02", certainty="confirmed", received=True)
        scenario = get("BudgetScenario").objects.create(owner_id=user.pk, state=state, kind="expected",
                                                        revision=1, inputs={}, result={})
        plan = get("FundingPlan").objects.create(owner_id=user.pk, scenario=scenario, inputs={}, result={})
        beneficiary = get("Beneficiary").objects.create(owner_id=user.pk, name="School",
                                                        destination_label="MOCK", verified=True)
        payment = get("Payment").objects.create(
            owner_id=user.pk, plan=plan, state=state, beneficiary=beneficiary, event_id="rent",
            amount=Decimal("500.00"), due_on="2026-10-05", status="settled")
        credit = get("DemoLedgerEntry").objects.create(
            owner_id=user.pk, funding_source=source, amount=Decimal("9000.00"),
            effective_on="2026-10-02", sequence=1)
        debit = get("DemoLedgerEntry").objects.create(
            owner_id=user.pk, payment=payment, amount=Decimal("-500.00"),
            effective_on="2026-10-02", sequence=2)
        return user, wallet, credit, debit

    def test_existing_wallet_and_ledger_are_preserved_as_home_currency(self):
        def body():
            executor = MigrationExecutor(connection)
            executor.migrate([BEFORE])
            old = executor.loader.project_state([BEFORE]).apps
            user, wallet, credit, debit = self.legacy_wallet(old)
            quote = old.get_model("finance", "FXQuote").objects.create(
                owner_id=user.pk, source_currency="USD", rate=Decimal("35.1234567890"),
                sender_fee=Decimal("1.00"), receiver_fee=Decimal("2.00"), settlement_days=1,
                expires_at="2026-10-03T00:00:00Z")

            executor = MigrationExecutor(connection)
            executor.migrate([AFTER])
            new = executor.loader.project_state([AFTER]).apps
            get = lambda name: new.get_model("finance", name)

            self.assertEqual(get("DemoWallet").objects.get(pk=wallet.pk).balance, Decimal("88500.00"))
            entries = {e.pk: e for e in get("DemoLedgerEntry").objects.all()}
            self.assertEqual(set(entries), {credit.pk, debit.pk})
            self.assertEqual(entries[credit.pk].amount, Decimal("9000.00"))
            self.assertEqual(entries[debit.pk].amount, Decimal("-500.00"))
            self.assertEqual((entries[credit.pk].sequence, entries[debit.pk].sequence), (1, 2))
            self.assertEqual({e.currency for e in entries.values()}, {"THB"})
            self.assertEqual(sum(e.amount for e in entries.values()),
                             Decimal("88500.00") - Decimal("80000.00"))
            self.assertEqual(get("WalletBalance").objects.count(), 0)
            self.assertEqual(get("CurrencyConversion").objects.count(), 0)
            migrated = get("FXQuote").objects.get(pk=quote.pk)
            self.assertEqual(migrated.target_currency, "THB")
            self.assertEqual(migrated.rate, Decimal("35.1234567890"))
            self.assertIsNone(migrated.consumed_at)
            self.assertIsNone(migrated.corridor_id)
            self.assertIsNone(migrated.quoted_amount)
            corridors = get("Corridor").objects.all()
            for source, target in [("CNY", "THB"), ("USD", "THB"), ("EUR", "THB"), ("THB", "CNY")]:
                tiers = sorted(c.tier for c in corridors.filter(source_currency=source, target_currency=target))
                self.assertEqual(tiers, ["economy", "express", "standard"], (source, target))
        self.in_schema(body)

    def test_reverse_with_only_home_rows_restores_old_schema(self):
        def body():
            executor = MigrationExecutor(connection)
            executor.migrate([BEFORE])
            _, wallet, credit, debit = self.legacy_wallet(executor.loader.project_state([BEFORE]).apps)
            MigrationExecutor(connection).migrate([AFTER])
            executor = MigrationExecutor(connection)
            executor.migrate([BEFORE])
            old = executor.loader.project_state([BEFORE]).apps
            get = lambda name: old.get_model("finance", name)
            self.assertEqual(get("DemoWallet").objects.get(pk=wallet.pk).balance, Decimal("88500.00"))
            amounts = dict(get("DemoLedgerEntry").objects.values_list("pk", "amount"))
            self.assertEqual(amounts, {credit.pk: Decimal("9000.00"), debit.pk: Decimal("-500.00")})
        self.in_schema(body)

    def test_reverse_refused_when_foreign_rows_exist(self):
        def body():
            executor = MigrationExecutor(connection)
            executor.migrate([BEFORE])
            user, wallet, _, _ = self.legacy_wallet(executor.loader.project_state([BEFORE]).apps)
            executor = MigrationExecutor(connection)
            executor.migrate([AFTER])
            new = executor.loader.project_state([AFTER]).apps
            get = lambda name: new.get_model("finance", name)
            source = get("FundingSource").objects.create(
                owner_id=user.pk, economic_key="held-cny", kind="external_savings", currency="CNY",
                amount=Decimal("100.00"), available_on="2026-10-02", certainty="confirmed", received=True)
            get("WalletBalance").objects.create(owner_id=user.pk, wallet_id=wallet.pk, currency="CNY",
                                                balance=Decimal("100.00"))
            get("DemoLedgerEntry").objects.create(
                owner_id=user.pk, funding_source=source, amount=Decimal("100.00"), currency="CNY",
                effective_on="2026-10-02", sequence=3)
            with self.assertRaises(Exception):
                MigrationExecutor(connection).migrate([BEFORE])
            # Still at 0015 with the foreign row intact.
            applied = MigrationExecutor(connection).loader.applied_migrations
            self.assertIn(AFTER, applied)
            self.assertEqual(get("DemoLedgerEntry").objects.filter(currency="CNY").count(), 1)
        self.in_schema(body)
