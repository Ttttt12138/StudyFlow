import importlib
from datetime import date, datetime
from zoneinfo import ZoneInfo

from studyflow_ai.readiness.api import ReadinessAI
from studyflow_ai.readiness.demo import DEMO_NOW, OFFER, FixtureBackend, run_demo
from studyflow_ai.readiness.models import ExtractionContext, MaterialSource


def add_parsers(commands):
    for name in ("readiness-demo", "readiness-schemas", "readiness-verify-live"):
        command = commands.add_parser(name)
        command.add_argument("--output")
    extract = commands.add_parser("readiness-extract")
    extract.add_argument("source")
    extract.add_argument("--kind", choices=["text", "pdf", "url"], required=True)
    extract.add_argument("--language", default="en")
    extract.add_argument("--reference-date", type=date.fromisoformat, default=date(2026, 10, 2))
    extract.add_argument("--output")
    check = commands.add_parser("readiness-check")
    check.add_argument("--backend-factory", required=True)
    check.add_argument("--student-id", default="student_001")
    check.add_argument("--output")
    evaluate = commands.add_parser("readiness-evaluate")
    evaluate.add_argument("--dataset", default="evals/readiness/cases.jsonl")
    evaluate.add_argument("--split", choices=["dev", "test"], default="test")
    evaluate.add_argument("--output", default="output/readiness-evaluation.json")


def schemas():
    from studyflow_ai.readiness import models

    names = (
        "MaterialSource",
        "ExtractionContext",
        "ExtractionResult",
        "SemesterDraft",
        "CompletenessResult",
        "FxRequest",
        "FxResult",
        "ReadinessState",
        "BudgetSnapshot",
        "FundingContext",
        "FundingResult",
        "ReadinessResult",
    )
    return {name: getattr(models, name).model_json_schema(mode="serialization") for name in names}


def dispatch(args, settings):
    if args.command == "readiness-schemas":
        return schemas()
    if args.command == "readiness-evaluate":
        from studyflow_ai.readiness.evaluation import evaluate

        return evaluate(args.dataset, settings, args.split)
    if args.command == "readiness-verify-live":
        if settings.mode != "live":
            raise ValueError("readiness-verify-live requires --mode live")
        return verify_live(settings)
    backend = FixtureBackend() if args.command == "readiness-demo" else None
    if args.command == "readiness-check":
        module, factory = args.backend_factory.split(":", 1)
        backend = getattr(importlib.import_module(module), factory)()
    ai = ReadinessAI.from_settings(settings, backend)
    try:
        if args.command == "readiness-demo":
            return run_demo(ai)
        if args.command == "readiness-check":
            return ai.run_readiness_check(
                args.student_id, "timer", datetime.now(ZoneInfo("Asia/Bangkok"))
            ).model_dump(mode="json")
        source = MaterialSource(
            source_id="cli-material",
            kind=args.kind,
            url=args.source if args.kind == "url" else None,
            path=args.source if args.kind != "url" else None,
        )
        return ai.extract_semester_material(
            source, ExtractionContext(reference_date=args.reference_date, language=args.language)
        ).model_dump(mode="json")
    finally:
        ai.close()


def verify_live(settings):
    runs = []
    for _ in range(3):
        ai = ReadinessAI.from_settings(settings, FixtureBackend())
        try:
            runs.append(run_demo(ai))
        finally:
            ai.close()
    ai = ReadinessAI.from_settings(settings)
    try:
        conflict = ai.extract_semester_material(
            MaterialSource(
                source_id="conflict",
                kind="text",
                text=OFFER + "\nTuition: THB 75000; period=semester; year=2025; campus=Phuket",
            ),
            ExtractionContext(reference_date=DEMO_NOW.date()),
        )
        completeness = ai.assess_cost_completeness(conflict.draft)
    finally:
        ai.close()
    passed = all(_demo_passed(run) for run in runs)
    conflict_passed = any(i.code == "CONFLICTING_COST" for i in completeness.issues)
    return {
        "live_verified": passed and conflict_passed,
        "runs": runs,
        "conflict_extraction": conflict.model_dump(mode="json"),
        "conflict_completeness": completeness.model_dump(mode="json"),
        "integration_acceptance": False,
        "verified_at": datetime.now(ZoneInfo("Asia/Bangkok")).isoformat(),
    }


def _demo_passed(run):
    extraction = run["extraction"]
    check = run["check"]
    calls = extraction["calls"] + (check["funding"]["calls"] if check["funding"] else [])
    return bool(
        run["material_linked"]
        and extraction["draft"]["profile"]["school"]
        and any(
            c["category"] == "tuition" and c["amount"] == "65000"
            for c in extraction["draft"]["costs"]
        )
        and check["funding"]
        and check["funding"]["candidates"]
        and any(c["validation"] == "CONDITIONAL" for c in check["funding"]["candidates"])
        and run["repeat_reused"]
        and not any(c["error_code"] for c in calls)
    )
