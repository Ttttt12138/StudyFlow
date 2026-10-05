import hashlib
import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from statistics import mean

from studyflow_ai.readiness.api import ReadinessAI
from studyflow_ai.readiness.demo import DEMO_NOW, FixtureBackend
from studyflow_ai.readiness.models import ExtractionContext, MaterialSource


def load_cases(path, split):
    path = Path(path)
    data = path.read_bytes()
    manifest = json.loads(path.with_name("manifest.json").read_text(encoding="utf-8"))
    if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        raise ValueError("Readiness dataset differs from frozen manifest")
    cases = [json.loads(line) for line in data.decode("utf-8").splitlines()]
    groups = {s: {c["family"] for c in cases if c["split"] == s} for s in ("dev", "test")}
    if groups["dev"] & groups["test"]:
        raise ValueError("Readiness template leakage")
    if any(sum(c["split"] == s for c in cases) != manifest["counts"][s] for s in groups):
        raise ValueError("Readiness dataset count mismatch")
    return [c for c in cases if c["split"] == split], manifest


def _same(field, predicted, expected):
    if field in ("amount", "lower", "upper") and predicted is not None and expected is not None:
        return Decimal(predicted) == Decimal(expected)
    return predicted == expected


def _extract_case(ai, case):
    result = ai.extract_semester_material(
        MaterialSource(source_id=case["case_id"], kind="text", text=case["text"]),
        ExtractionContext(reference_date=DEMO_NOW.date(), language=case["language"]),
    )
    complete = ai.assess_cost_completeness(result.draft)
    expected = case["expected"]
    assertions = []
    profile = result.draft.profile.model_dump(mode="json")
    for field, value in expected.get("profile", {}).items():
        assertions.append(profile[field] == value)
    if "cost" in expected:
        assertions.append(
            any(
                all(
                    _same(k, c.model_dump(mode="json").get(k), v)
                    for k, v in expected["cost"].items()
                )
                for c in result.draft.costs
            )
        )
    issues = {i.code for i in result.issues + complete.issues}
    assertions.extend(code in issues for code in expected.get("issues", []))
    if "route" in expected:
        assertions.append(result.route == expected["route"])
    return (
        assertions,
        result.calls,
        {
            "extraction": result.model_dump(mode="json"),
            "completeness": complete.model_dump(mode="json"),
        },
    )


def _funding_case(ai, case):
    backend = FixtureBackend()
    state = backend.state
    context = backend.funding_context(state, backend.calculate_budget(state, DEMO_NOW), DEMO_NOW)
    if "unaffordable" in case["family"]:
        context.loan_quotes[0].affordability = "UNAFFORDABLE"
        context.loan_quotes[0].missing_inputs = []
    else:
        context.loan_quotes[0].missing_inputs = [f"future income variant {case['variant']}"]
    result = ai.generate_funding_candidates(context)
    assertions = [
        case["expected"]["loan_message"] in result.loan_explanations[0].message,
        result.loan_explanations[0].quote == context.loan_quotes[0],
        bool(result.candidates),
    ]
    return assertions, result.calls, result.model_dump(mode="json")


def evaluate(path, settings, split):
    cases, manifest = load_cases(path, split)
    ai, rows = ReadinessAI.from_settings(settings), []
    try:
        for case in cases:
            started = time.perf_counter()
            assertions, calls, output = (
                _funding_case if case["kind"] == "funding" else _extract_case
            )(ai, case)
            errors = [c.error_code for c in calls if c.error_code]
            rows.append(
                {
                    "case_id": case["case_id"],
                    "passed": all(assertions) and not errors,
                    "assertions": len(assertions),
                    "correct_assertions": sum(assertions),
                    "elapsed_ms": (time.perf_counter() - started) * 1000,
                    "calls": [c.model_dump(mode="json") for c in calls],
                    "errors": errors,
                    "output": output,
                }
            )
    finally:
        ai.close()
    calls = [call for row in rows for call in row["calls"]]
    return {
        "schema_version": "2.0",
        "mode": settings.mode,
        "split": split,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "samples": len(rows),
        "synthetic": True,
        "human_reviewed": manifest["human_reviewed"],
        "live_acceptance": False,
        "case_pass_rate": mean(row["passed"] for row in rows) if rows else None,
        "mean_latency_ms": mean(row["elapsed_ms"] for row in rows) if rows else None,
        "model_versions": sorted({c["model"] for c in calls}),
        "prompt_versions": sorted({c["prompt_version"] for c in calls}),
        "input_tokens": sum(c["input_tokens"] for c in calls),
        "output_tokens": sum(c["output_tokens"] for c in calls),
        "llm_calls": sum(c["provider"] == "openai" for c in calls),
        "failed_cases": [row["case_id"] for row in rows if not row["passed"]],
        "cases": rows,
    }
