"""seed_demo prepares a usable demo student (README quick start, docker compose)."""
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase

from finance.workflow_models import DemoLedgerEntry, DemoWallet, FundingSource


class SeedDemoTests(TestCase):
    def test_demo_student_holds_family_cny_for_wallet_and_agent_journeys(self):
        # TestCase never runs on_commit callbacks, so no credential file is written here.
        call_command("seed_demo", stdout=StringIO())
        student = get_user_model().objects.get(username="demo-student")
        self.assertTrue(DemoWallet.objects.filter(owner=student).exists())
        source = FundingSource.objects.get(owner=student, currency="CNY")
        self.assertEqual(str(source.amount), "40000.00")
        credited = sum(e.amount for e in DemoLedgerEntry.objects.filter(owner=student, currency="CNY"))
        self.assertEqual(str(credited), "40000.00")
        with self.assertRaises(CommandError):
            call_command("seed_demo", stdout=StringIO())
