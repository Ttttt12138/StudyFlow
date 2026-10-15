"""Upgrade populated legacy student data in a separate PostgreSQL schema."""
from datetime import date
from decimal import Decimal
from unittest import skipUnless
from uuid import uuid4

from django.db import DatabaseError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


@skipUnless(connection.vendor == "postgresql", "Requires isolated PostgreSQL schema")
class StudentFlowMigrationTests(TransactionTestCase):
    def test_upgrade_preserves_ledger_and_converts_legacy_plan_states(self):
        schema = "student_migration_" + uuid4().hex
        with connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{schema}"')
            cursor.execute(f'SET search_path TO "{schema}"')
        try:
            executor = MigrationExecutor(connection)
            before = [("finance", "0034_ledger_credit_charge")]
            executor.migrate(before)
            old = executor.loader.project_state(before).apps
            user = old.get_model("auth", "User").objects.create(username="legacy-student")
            other = old.get_model("auth", "User").objects.create(username="legacy-no-loan")
            enrolled_user = old.get_model("auth", "User").objects.create(username="legacy-enrolled-no-loan")
            loan = old.get_model("finance", "LoanSimulation").objects.create(owner_id=user.pk, inputs={}, result={})
            app = old.get_model("finance", "SimulatedApplication").objects.create(owner_id=user.pk, loan=loan, status="APPROVED")
            Plan = old.get_model("finance", "StudyPlan")
            plan = Plan.objects.create(owner_id=user.pk, school_key="psu-phuket", catalog_version=3,
                                       start_date="2027-08-09", status="ENROLLED", loan=loan)
            no_loan = Plan.objects.create(owner_id=other.pk, school_key="psu-phuket", catalog_version=3,
                                          start_date="2027-08-09", status="CONFIRMED")
            # This row changes twice (ENROLLED -> CONFIRMED -> DRAFT) in one migration transaction.
            enrolled_no_loan = Plan.objects.create(owner_id=enrolled_user.pk, school_key="psu-phuket",
                catalog_version=3, start_date="2027-08-09", status="ENROLLED")
            bill = old.get_model("finance", "PlanBill").objects.create(owner_id=user.pk, plan=plan, kind="housing",
                source_id="old-housing", due_date="2026-10-01", amount="120.00", currency="THB", status="PAID")
            charge = old.get_model("finance", "CreditCharge").objects.create(owner_id=user.pk, plan=plan, bill=bill,
                amount="120.00", currency="THB", charged_on="2026-10-01", due_date="2026-10-10", repaid_on="2026-10-09")
            entry = old.get_model("finance", "DemoLedgerEntry").objects.create(owner_id=user.pk,
                credit_charge=charge, amount="-120.00", currency="THB", effective_on="2026-10-09")
            notice = old.get_model("finance", "StudyTask").objects.create(owner_id=user.pk, plan=plan,
                title="Provide admission", template_key="loan_doc:admission", done=False)
            executor = MigrationExecutor(connection)
            after = [("finance", "0035_simplify_student_loan_flow")]
            executor.migrate(after)
            new = executor.loader.project_state(after).apps
            saved = new.get_model("finance", "DemoLedgerEntry").objects.get(pk=entry.pk)
            self.assertEqual(saved.retired_credit_charge, charge.pk)
            self.assertEqual(saved.amount, Decimal("-120.00"))
            self.assertEqual(saved.currency, entry.currency)
            self.assertEqual(saved.effective_on, date(2026, 10, 9))
            self.assertEqual(saved.created_at, entry.created_at)
            self.assertEqual(saved.sequence, entry.sequence)
            self.assertEqual(saved.owner_id, entry.owner_id)
            self.assertEqual(new.get_model("finance", "StudyPlan").objects.get(pk=plan.pk).status, "CONFIRMED")
            self.assertEqual(new.get_model("finance", "StudyPlan").objects.get(pk=no_loan.pk).status, "DRAFT")
            self.assertEqual(new.get_model("finance", "StudyPlan").objects.get(pk=enrolled_no_loan.pk).status, "DRAFT")
            self.assertTrue(new.get_model("finance", "StudyTask").objects.get(pk=notice.pk).done)
            self.assertEqual(new.get_model("finance", "SimulatedApplication").objects.get(pk=app.pk).status, "APPROVED")
            self.assertEqual(new.get_model("finance", "PlanBill").objects.get(pk=bill.pk).status, "PAID")
            self.assertNotIn("finance_creditcharge", connection.introspection.table_names())
            self.assert_history_is_immutable(new, entry.pk)
        finally:
            with connection.cursor() as cursor:
                cursor.execute("SET search_path TO public")
                cursor.execute(f'DROP SCHEMA "{schema}" CASCADE')

    def assert_history_is_immutable(self, apps, entry_id):
        Ledger = apps.get_model("finance", "DemoLedgerEntry")
        with self.assertRaisesMessage(DatabaseError, "financial history is append-only"):
            with transaction.atomic():
                Ledger.objects.filter(pk=entry_id).update(amount=Decimal("-1.00"))
