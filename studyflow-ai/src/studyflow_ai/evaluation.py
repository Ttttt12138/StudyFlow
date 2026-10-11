"""Shared evaluation harness. Offline smoke results never count as live acceptance."""

import hashlib
import json
import time
from datetime import datetime, timezone
from math import sqrt
from pathlib import Path
from statistics import mean

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.config import Settings, providers
from studyflow_ai.demo_backend import DEMO_NOW, DemoBackend
from studyflow_ai.evaluation_safety import (
    REVIEW_POLICIES,
    V5_SCORING_POLICY,
    null_date_safety,
    review_safety_met,
    scored_events,
)
from studyflow_ai.event_matching import event_match_metrics, match_events
from studyflow_ai.models import IngestContext, Source, Status
from studyflow_ai.providers import prompts
from studyflow_ai.providers.rules import RuleProvider


def load_cases(path, split):
    path = Path(path)
    data = path.read_bytes()
    manifest = json.loads(path.with_name("manifest.json").read_text(encoding="utf-8"))
    if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        raise ValueError("Evaluation dataset does not match the frozen manifest")
    cases = [json.loads(line) for line in data.decode("utf-8").splitlines()]
    groups = {
        name: {case["family"] for case in cases if case["split"] == name}
        for name in ("dev", "test")
    }
    if groups["dev"] & groups["test"]:
        raise ValueError("Evaluation template leakage")
    return [case for case in cases if case["split"] == split], manifest


def _event_matches(predicted, expected):
    # Family promises may carry their scheduled receipt in either date field in v1.
    predicted = [
        {**item, "due_date": item.get("date") or item.get("due_date")}
        if item.get("category") == "family_support" else item
        for item in predicted
    ]
    return any(
        all(
            item.get(field) == expected[field]
            for field in ("category", "amount", "currency", "due_date")
        )
        for item in predicted
    )


def _date_safety(events, expected):
    checks = [e for e in expected if e.get("due_date_kind") == "inferred"]
    failures = 0
    for target in checks:
        matches = [e for e in events if _event_matches([e], target)]
        safe = any(
            e["confidence_type"] == "INFERRED" and e["status"] == "NEEDS_REVIEW"
            and any(i["code"] == "INFERRED_DUE_DATE" and i["field"] == "due_date" for i in e["issues"])
            and any(v["field"] == "due_date" and v["quote"] and v["locator"] for v in e["evidence"])
            for e in matches
        )
        failures += not safe
    return len(checks), failures


def evaluate_case(ai, case, scoring_policy="complete_only"):
    complete = scored_events(case["expected_events"], scoring_policy)
    started = time.perf_counter()
    context = IngestContext(
        reference_date=DEMO_NOW.date(),
        verified_source_ids=[case["case_id"]],
        verification_reference="synthetic-eval-fixture",
    )
    result = ai.ingest(Source(source_id=case["case_id"], kind="email", text=case["text"]), context)
    calls = list(result.calls)
    plans = []
    if case["backend_risk"]:
        check = ai.run_check("student_001", "evaluation", DEMO_NOW)
        calls.extend(c for route in check.routes for c in route.calls)
        calls.extend(c for batch in check.planning for c in batch.calls)
        plans = [p.model_dump(mode="json") for batch in check.planning for p in batch.plans]
    judgment = result.routing.classification if result.routing else None
    events = [e.model_dump(mode="json") for e in result.candidates]
    correct = bool(judgment and judgment.category == case["category"])
    correct_fields = sum(_event_matches(events, e) for e in complete)
    matching = {}
    if scoring_policy == V5_SCORING_POLICY:
        matching = match_events(events, complete)
        correct_fields = len(matching["event_matches"])
    date_checks, date_failures = _date_safety(events, case["expected_events"])
    null_checks, null_failures = (0, 0)
    if scoring_policy in REVIEW_POLICIES:
        null_checks, null_failures = null_date_safety(
            events, case["expected_events"], result.status != Status.READY,
        )
    reasons = []
    if not correct:
        reasons.append("CLASSIFICATION_MISMATCH")
    if correct_fields < len(complete):
        reasons.append("JOINT_FIELDS_MISMATCH")
    if date_failures:
        reasons.append("INFERRED_DATE_SAFETY_FAILED")
    if null_failures:
        reasons.append("NULL_DATE_SAFETY_FAILED")
    if matching.get("unexpected_event_indices"):
        reasons.append("UNEXPECTED_EVENTS")
    if matching.get("duplicate_event_indices"):
        reasons.append("DUPLICATE_EVENTS")
    if any(c.error_code for c in calls):
        reasons.append("PROVIDER_ERROR")
    if case.get("expected_review") and result.status == Status.READY:
        reasons.append("EXPECTED_REVIEW_MISSING")
    # An automatic (READY) result is wrong when anything a reviewer would have caught slipped by.
    wrong_auto = result.status == Status.READY and (
        case.get("dangerous", False)
        or case.get("expected_review", False)
        or not correct
        or correct_fields < len(complete)
        or bool(matching.get("unexpected_event_indices"))
        or (bool(case["expected_events"]) and not events)
    )
    return {
        "case_id": case["case_id"],
        "category": judgment.category if judgment else None,
        "classification": {key: getattr(judgment, key, None) for key in (
            "category", "probabilities", "confidence", "financial_relevance", "anomaly",
            "instruction_risk", "payment_conflict", "needs_planning",
        )} if judgment else None,
        "correct_classification": correct,
        "review": result.status != Status.READY,
        "dangerous": case.get("dangerous", False),
        "expected_review": case.get("expected_review", False),
        "wrong_auto_decision": wrong_auto,
        "expected_irrelevant": case["category"] == "irrelevant",
        "false_positive": case["category"] == "irrelevant" and bool(events),
        "critical_silent_miss": case["important"]
        and not events
        and not case["backend_risk"]
        and result.status == Status.READY,
        "missing_event": bool(case["expected_events"]) and not events,
        "complete_field_cases": len(complete),
        "correct_field_cases": correct_fields,
        "date_safety_checks": date_checks,
        "date_safety_failures": date_failures,
        "null_date_safety_checks": null_checks,
        "null_date_safety_failures": null_failures,
        "scoring_policy": scoring_policy,
        **matching,
        "failure_reasons": reasons,
        "latency_ms": (time.perf_counter() - started) * 1000,
        "calls": [c.model_dump(mode="json") for c in calls],
        "plans": plans,
        "predicted_events": events,
        "issues": [i.code for i in result.issues]
        + [i.code for e in result.candidates for i in e.issues],
    }


def summarize(rows):
    count = len(rows)
    if not count:
        raise ValueError("Empty evaluation split")
    calls = [c for row in rows for c in row["calls"]]
    llm = [c for c in calls if c["provider"] == "openai"]
    denominator = sum(r["complete_field_cases"] for r in rows)
    latencies = sorted(r["latency_ms"] for r in rows)
    irrelevant = sum(r["expected_irrelevant"] for r in rows)
    return {
        "samples": count,
        "classification_accuracy": mean(r["correct_classification"] for r in rows),
        "joint_field_accuracy": sum(r["correct_field_cases"] for r in rows) / denominator
        if denominator
        else None,
        "joint_field_denominator": denominator,
        "critical_silent_misses": sum(r["critical_silent_miss"] for r in rows),
        "missing_event_rate": mean(r["missing_event"] for r in rows),
        "review_rate": mean(r["review"] for r in rows),
        "false_positive_rate": sum(r["false_positive"] for r in rows) / irrelevant
        if irrelevant
        else None,
        "latency_mean_ms": mean(latencies),
        "latency_p95_ms": latencies[min(count - 1, int(count * 0.95))],
        "llm_calls_per_event": len(llm) / count,
        "llm_event_invocation_rate": mean(
            any(c["provider"] == "openai" for c in r["calls"]) for r in rows
        ),
        "llm_calls_by_purpose": {
            p: sum(c["purpose"] == p for c in llm) for p in ("classify", "extract", "plan")
        },
        "input_tokens": sum(c["input_tokens"] for c in calls),
        "output_tokens": sum(c["output_tokens"] for c in calls),
        "provider_errors": sum(c["error_code"] is not None for c in calls),
        "call_count": len(calls),
        "date_safety_checks": sum(r.get("date_safety_checks", 0) for r in rows),
        "date_safety_failures": sum(r.get("date_safety_failures", 0) for r in rows),
        "null_date_safety_checks": sum(r.get("null_date_safety_checks", 0) for r in rows),
        "null_date_safety_failures": sum(r.get("null_date_safety_failures", 0) for r in rows),
        "models": sorted({c["model"] for c in calls}),
        "acceptance_targets_met": (
            mean(r["correct_classification"] for r in rows) >= 0.9
            and denominator > 0
            and sum(r["correct_field_cases"] for r in rows) / denominator >= 0.95
            and not any(r["critical_silent_miss"] for r in rows)
        ),
        **_decision_metrics(rows),
        **event_match_metrics(rows),
    }


def wilson_interval(successes, total, z=1.96):
    if not total:
        return None
    p = successes / total
    scale = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / scale
    half = z * sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / scale
    return [max(0.0, centre - half), min(1.0, centre + half)]


def _decision_metrics(rows):
    """Selective-decision metrics from docs/protocol-holdout-v4.md; dangerous rows are
    judged only by their block rate, never in the classification denominator."""
    safe = [r for r in rows if not r.get("dangerous")]
    dangerous = [r for r in rows if r.get("dangerous")]
    irrelevant = [r for r in rows if r["expected_irrelevant"]]
    auto = [r for r in rows if not r["review"]]
    wrong = sum(r.get("wrong_auto_decision", False) for r in rows)
    return {
        "classification_accuracy_excluding_dangerous": mean(
            r["correct_classification"] for r in safe
        ) if safe else None,
        "dangerous_denominator": len(dangerous),
        "dangerous_block_rate": mean(r["review"] for r in dangerous) if dangerous else None,
        "auto_decisions": len(auto),
        "wrong_auto_decisions": wrong,
        "auto_coverage": mean(not r["review"] for r in safe) if safe else None,
        "auto_precision": (len(auto) - wrong) / len(auto) if auto else None,
        "auto_precision_wilson95": wilson_interval(len(auto) - wrong, len(auto)),
        "irrelevant_review_rate": mean(r["review"] for r in irrelevant) if irrelevant else None,
    }


# Per-arm role gates (docs/protocol-holdout-v4.md); "legacy" reproduces the v1-v3 gate.
ARM_ROLES = {"rules": "selective", "llm_only": "accuracy", "jev_llm": "accuracy"}
MAX_IRRELEVANT_REVIEW_RATE = 0.20


def legacy_targets_met(metrics):
    return bool(
        metrics["acceptance_targets_met"]
        and metrics["provider_errors"] == 0
        and metrics["dangerous_block_rate"] == 1.0
    )


def arm_targets_met(metrics, manifest):
    base = role_targets_met(metrics, metrics["role"]) if manifest.get("acceptance") == "role-v1" else legacy_targets_met(metrics)
    policy = manifest.get("scoring_policy", "complete_only")
    scored_events([], policy)  # Reject unknown policies even if no samples produced fields.
    if policy in REVIEW_POLICIES:
        return bool(base and review_safety_met(metrics, policy))
    return bool(base and (not manifest.get("require_inferred_date_safety") or metrics["date_safety_failures"] == 0))


def role_targets_met(metrics, role):
    safe = (
        metrics["provider_errors"] == 0
        and metrics["critical_silent_misses"] == 0
        and metrics["dangerous_block_rate"] == 1.0
        and metrics["wrong_auto_decisions"] == 0
    )
    if role == "selective":
        rate = metrics["irrelevant_review_rate"]
        return bool(safe and rate is not None and rate <= MAX_IRRELEVANT_REVIEW_RATE)
    if role == "accuracy":
        accuracy = metrics["classification_accuracy_excluding_dangerous"]
        fields = metrics["joint_field_accuracy"]
        return bool(
            safe and accuracy is not None and accuracy >= 0.9 and fields is not None and fields >= 0.95
        )
    raise ValueError(f"Unknown arm role: {role}")


def evaluate(dataset, settings: Settings, split="test"):
    cases, manifest = load_cases(dataset, split)
    classifier, llm = providers(settings)
    rules = RuleProvider()
    arms = {"rules": (rules, rules), "llm_only": (llm, llm), "jev_llm": (classifier, llm)}
    report = {
        "mode": settings.mode,
        "live_run": settings.mode == "live",
        "live_acceptance": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "split": split,
        "dataset": manifest,
        "prompt_version": prompts.VERSION,
        "prompt_sha256": hashlib.sha256(
            (prompts.EXTRACT + prompts.PLAN + prompts.CLASSIFY).encode()
        ).hexdigest(),
        "limitations": [
            "Synthetic unreviewed text fixtures",
            "B is the same demo adapter in all arms",
            "Offline mock arms use rules and are not model comparisons",
        ],
        "arms": {},
    }
    try:
        for name, pair in arms.items():
            rows = [evaluate_case(StudyFlowAI(*pair, DemoBackend()), case) for case in cases]
            report["arms"][name] = {"metrics": summarize(rows), "cases": rows}
            if settings.mode != "live":
                report["arms"][name]["metrics"]["acceptance_targets_met"] = None
        proposed = report["arms"]["jev_llm"]["metrics"]
        report["live_acceptance"] = bool(
            settings.mode == "live"
            and split == "test"
            and manifest["human_reviewed"]
            and proposed["acceptance_targets_met"]
            and proposed["provider_errors"] == 0
        )
    finally:
        for provider in {id(p): p for p in (classifier, llm)}.values():
            provider.close()
    return report
