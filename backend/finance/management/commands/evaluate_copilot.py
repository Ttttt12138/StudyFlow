import json
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from studyflow_ai.config import Settings, load_env_file
from studyflow_ai.copilot_evaluation import evaluate


class Command(BaseCommand):
    help = "Run multilingual three-arm benchmarks; live test requires reviewed labels."

    def add_arguments(self, parser):
        parser.add_argument("--mode", choices=["mock", "live"], default="mock")
        parser.add_argument("--split", choices=["dev", "test"], default="dev")
        parser.add_argument("--env-file", type=Path)
        parser.add_argument("--review", type=Path)
        parser.add_argument("--dataset", type=Path)
        parser.add_argument(
            "--arm", choices=["rules", "llm_only", "jev_llm"], action="append"
        )
        parser.add_argument("--output", type=Path)
        parser.add_argument(
            "--evaluation-kind",
            choices=["frozen_test", "regression"],
            default="frozen_test",
        )

    def handle(self, *args, **options):
        if options["env_file"]:
            load_env_file(options["env_file"])
        output = options["output"] or Path("output") / (
            "copilot-eval-" + uuid4().hex + ".json"
        )
        if output.exists():
            raise CommandError("Report already exists")
        dataset = (
            options["dataset"]
            or settings.STUDYFLOW_AI_DIR / "evals/copilot-v1/cases.jsonl"
        )

        def progress(arm, done, total, partial=None):
            if done % 10 == 0:
                self.stdout.write(f"{arm}: {done}/{total}")
                self.stdout.flush()
            if partial is not None:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(
                    json.dumps(partial, ensure_ascii=False, indent=2), encoding="utf-8"
                )

        try:
            report = evaluate(
                dataset,
                Settings.from_env(options["mode"]),
                options["split"],
                options["review"],
                progress,
                options["arm"],
                options["evaluation_kind"],
                run_output=output,
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self.stdout.write(
            f"Report: {output}; live_acceptance={report['live_acceptance']}"
        )
        outage = report.get("provider_outage")
        if outage:
            raise CommandError(
                f"Provider outage in {outage['arm']}: stopped after "
                f"{outage['consecutive_case_limit']} consecutive failed cases; "
                f"{outage['samples_skipped']} samples and arms {outage['arms_not_run']} not run"
            )
        if (
            options["mode"] == "live"
            and options["split"] == "test"
            and not all(a["metrics"]["targets_met"] for a in report["arms"].values())
        ):
            raise CommandError("Selected benchmark arms did not meet every target")
