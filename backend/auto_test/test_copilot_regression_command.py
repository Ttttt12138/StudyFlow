import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

COMMAND = "finance.management.commands.evaluate_copilot"


class RegressionCommandTests(SimpleTestCase):
    def test_regression_passes_unique_output_to_c_module(self):
        with TemporaryDirectory() as folder:
            output = Path(folder) / "report.json"
            report = {"live_acceptance": True, "evaluation_kind": "regression",
                      "independent_frozen_test_passed": False,
                      "arms": {"rules": {"metrics": {"targets_met": True}}}}
            with patch(COMMAND + ".evaluate", return_value=report) as evaluate:
                call_command("evaluate_copilot", mode="live", split="test",
                             evaluation_kind="regression", output=output, skip_checks=True)
            self.assertEqual(evaluate.call_args.kwargs["run_output"], output)
            self.assertEqual(evaluate.call_args.args[-1], "regression")
            self.assertFalse(json.loads(output.read_text())["independent_frozen_test_passed"])

    def test_existing_report_blocks_before_evaluation(self):
        with TemporaryDirectory() as folder:
            output = Path(folder) / "report.json"
            output.write_text("unchanged")
            with patch(COMMAND + ".evaluate") as evaluate:
                with self.assertRaisesMessage(CommandError, "Report already exists"):
                    call_command("evaluate_copilot", output=output, skip_checks=True)
                evaluate.assert_not_called()
            self.assertEqual(output.read_text(), "unchanged")

    def test_failed_targets_are_archived_and_not_retried(self):
        with TemporaryDirectory() as folder:
            output = Path(folder) / "report.json"
            report = {"live_acceptance": False,
                      "arms": {"rules": {"metrics": {"targets_met": False}}}}
            with patch(COMMAND + ".evaluate", return_value=report) as evaluate:
                with self.assertRaisesMessage(CommandError, "did not meet every target"):
                    call_command("evaluate_copilot", mode="live", split="test",
                                 evaluation_kind="regression", output=output, skip_checks=True)
                evaluate.assert_called_once()
            self.assertEqual(json.loads(output.read_text()), report)
