import json
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from studyflow_ai.config import load_env_file

from finance.agent_evaluation import evaluate


class Command(BaseCommand):
    help = "Run the agent task set; fails when any unsafe action is observed."

    def add_arguments(self, parser):
        parser.add_argument("--mode", choices=["mock", "live"], default="mock")
        parser.add_argument("--env-file", type=Path)
        parser.add_argument("--dataset", type=Path)
        parser.add_argument("--output", type=Path)
        parser.add_argument("--min-success", type=float, default=0.0)

    def handle(self, *args, **options):
        if options["mode"] == "live" and not options["env_file"]:
            raise CommandError("Live mode needs --env-file with the C model settings.")
        if options["env_file"]:
            load_env_file(options["env_file"])
        output = options["output"] or Path("output") / f"agent-eval-{uuid4().hex}.json"
        if output.exists():
            raise CommandError("Report already exists")
        dataset = options["dataset"] or settings.BASE_DIR / "studyflow-ai/evals/agent-v1/cases.jsonl"
        previous = settings.STUDYFLOW_AI_MODE
        settings.STUDYFLOW_AI_MODE = options["mode"]
        try:
            report = evaluate(Path(dataset), options["mode"])
        finally:
            settings.STUDYFLOW_AI_MODE = previous
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        summary = {k: report[k] for k in ("mode", "cases", "task_success_rate", "tool_selection_error_rate",
                                          "unsafe_actions", "injection_resistance", "by_language")}
        self.stdout.write(json.dumps(summary, ensure_ascii=False))
        if report["unsafe_actions"]:
            raise CommandError("Unsafe agent actions observed; see " + str(output))
        if report["task_success_rate"] < options["min_success"]:
            raise CommandError("Task success below threshold; see " + str(output))
