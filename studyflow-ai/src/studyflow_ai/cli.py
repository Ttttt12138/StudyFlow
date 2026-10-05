import argparse
import importlib
import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.config import Settings, load_env_file, providers
from studyflow_ai.demo import run_demo
from studyflow_ai.models import IngestContext, Source
from studyflow_ai.providers.base import ProviderFailure


def write_json(path, value):
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    else:
        print(text)


def parser():
    root = argparse.ArgumentParser(description="StudyFlow C module: explicit mock/live mode")
    root.add_argument("--mode", choices=["mock", "live"], default=None)
    root.add_argument("--env-file", help="Explicit local configuration file; never auto-discovered")
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("demo", "verify-live", "schemas"):
        command = commands.add_parser(name)
        command.add_argument("--output")
    ingest = commands.add_parser("ingest")
    ingest.add_argument("path")
    ingest.add_argument("--kind", choices=["csv", "email", "pdf"], required=True)
    ingest.add_argument("--reference-date", type=date.fromisoformat, default=date(2026, 10, 2))
    ingest.add_argument("--output")
    evaluation = commands.add_parser("evaluate")
    evaluation.add_argument("--dataset", default="evals/cases.jsonl")
    evaluation.add_argument("--split", choices=["dev", "test"], default="test")
    evaluation.add_argument("--output", default="output/evaluation.json")
    check = commands.add_parser("check")
    check.add_argument(
        "--backend-factory", required=True, help="B factory module:function; no args"
    )
    check.add_argument("--student-id", default="student_001")
    check.add_argument("--output")
    from studyflow_ai.readiness.cli import add_parsers

    add_parsers(commands)
    return root


def schemas():
    from studyflow_ai import models
    from studyflow_ai.import_jobs import Confirmation, ImportJob

    names = (
        "Source",
        "IngestContext",
        "IngestResult",
        "RouteContext",
        "RouteResult",
        "RecurringObligation",
        "FinancialSnapshot",
        "Forecast",
        "PlanningContext",
        "PlanResult",
        "CheckResult",
        "AuditEvent",
    )
    types = [getattr(models, name) for name in names] + [Confirmation, ImportJob]
    return {model.__name__: model.model_json_schema(mode="serialization") for model in types}


def verify_live(classifier, llm):
    calls, errors = [], []
    for provider, purpose in ((classifier, "classify"), (llm, "extract")):
        try:
            _, record = getattr(provider, purpose)(
                "Tuition THB 65000 due 2026-10-15. Beneficiary: PSU"
            )
            calls.append(record.model_dump(mode="json"))
        except ProviderFailure as exc:
            calls.append(exc.record.model_dump(mode="json"))
            errors.append(exc.code)
    return {"live_verified": not errors, "calls": calls, "errors": errors}


def _model_command(args, settings):
    classifier, llm = providers(settings)
    ai = StudyFlowAI(classifier, llm)
    try:
        if args.command == "demo":
            return run_demo(classifier, llm)
        if args.command == "verify-live":
            return verify_live(classifier, llm)
        if args.command == "ingest":
            source = Source(source_id=Path(args.path).name, kind=args.kind, path=args.path)
            return ai.ingest(source, IngestContext(reference_date=args.reference_date)).model_dump(
                mode="json"
            )
        module, factory = args.backend_factory.split(":", 1)
        backend = getattr(importlib.import_module(module), factory)()
        flow = StudyFlowAI(classifier, llm, backend)
        return flow.run_check(
            args.student_id, "timer", datetime.now(ZoneInfo("Asia/Bangkok"))
        ).model_dump(mode="json")
    finally:
        ai.close()


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.env_file:
            load_env_file(args.env_file)
        settings = Settings.from_env(args.mode)
        if args.command.startswith("readiness-"):
            from studyflow_ai.readiness.cli import dispatch

            result = dispatch(args, settings)
        elif args.command == "schemas":
            result = schemas()
        elif args.command == "evaluate":
            from studyflow_ai.evaluation import evaluate

            result = evaluate(args.dataset, settings, args.split)
        else:
            if args.command == "verify-live" and settings.mode != "live":
                raise ValueError("verify-live requires --mode live")
            result = _model_command(args, settings)
        write_json(args.output, result)
        return 1 if result.get("live_verified") is False else 0
    except (ValueError, OSError, ProviderFailure) as exc:
        # These errors are local config/input errors or sanitized ProviderFailure.
        write_json(getattr(args, "output", None), {"status": "NOT_VERIFIED", "error": str(exc)})
        return 2
    except Exception as exc:
        write_json(
            getattr(args, "output", None),
            {"status": "FAILED", "error": "INTERNAL_ERROR", "error_type": type(exc).__name__},
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
