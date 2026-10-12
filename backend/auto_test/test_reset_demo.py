"""reset_demo wipes the database, so it must refuse unless the deployment and the caller both opt in."""
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings


class ResetDemoGuardTests(TestCase):
    def setUp(self):
        get_user_model().objects.create_user(username="keep-me")

    def assertRefused(self, message, *args):
        with self.assertRaisesMessage(CommandError, message):
            call_command("reset_demo", *args, stdout=StringIO())
        self.assertTrue(get_user_model().objects.filter(username="keep-me").exists())

    @override_settings(STUDYFLOW_ALLOW_DEMO_RESET=False)
    def test_refuses_unless_the_deployment_allows_it(self):
        self.assertRefused("STUDYFLOW_ALLOW_DEMO_RESET", "--yes")

    @override_settings(STUDYFLOW_ALLOW_DEMO_RESET=True)
    def test_refuses_without_yes(self):
        self.assertRefused("--yes")
