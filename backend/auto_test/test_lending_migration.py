from unittest import skipUnless
from uuid import uuid4

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


@skipUnless(connection.vendor == "postgresql", "Isolated PostgreSQL migration schema")
class LendingMigrationTests(TransactionTestCase):
    def test_legacy_settled_loan_is_adopted_without_recredit(self):
        schema = "migration_test_" + uuid4().hex
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            cursor.execute(f'SET search_path TO "{schema}"')
        try:
            executor = MigrationExecutor(connection)
            before = [("finance", "0004_immutable_records")]
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            user = apps.get_model("auth", "User").objects.create(username="legacy")
            loan = apps.get_model("finance", "LoanSimulation").objects.create(
                owner_id=user.pk,
                inputs={},
                result={
                    "schedule": [
                        {
                            "number": 1,
                            "due_date": "2026-11-01",
                            "payment": "100.00",
                            "principal": "100.00",
                        }
                    ]
                },
            )
            application = apps.get_model(
                "finance", "SimulatedApplication"
            ).objects.create(owner_id=user.pk, loan=loan, status="approved")
            disbursement = apps.get_model("finance", "Disbursement").objects.create(
                owner_id=user.pk,
                application=application,
                amount="100",
                scheduled_on="2026-10-02",
                status="settled",
            )
            apps.get_model("finance", "DemoLedgerEntry").objects.create(
                owner_id=user.pk,
                disbursement=disbursement,
                amount="100",
                effective_on="2026-10-02",
            )
            executor = MigrationExecutor(connection)
            target = [("finance", "0006_adopt_b_lending")]
            executor.migrate(target)
            apps = executor.loader.project_state(target).apps
            self.assertEqual(
                apps.get_model("finance", "LoanAccount")
                .objects.get()
                .outstanding_principal,
                100,
            )
            self.assertEqual(
                apps.get_model("finance", "LoanInstallment").objects.count(), 1
            )
            self.assertEqual(
                apps.get_model("finance", "SimulatedApplication").objects.get().status,
                "DISBURSED",
            )
            self.assertEqual(
                apps.get_model("finance", "DemoLedgerEntry").objects.count(), 1
            )
        finally:
            with connection.cursor() as cursor:
                cursor.execute("SET search_path TO public")
                cursor.execute(f'DROP SCHEMA "{schema}" CASCADE')
