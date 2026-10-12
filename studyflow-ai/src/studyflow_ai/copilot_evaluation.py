"""Three-arm evaluation with a human-review gate and inspectable denominators."""

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.config import providers
from studyflow_ai.demo_backend import DemoBackend
from studyflow_ai.evaluation import (
    ARM_ROLES,
    arm_targets_met,
    evaluate_case,
    legacy_targets_met,
    load_cases,
    role_targets_met,
    summarize,
)
from studyflow_ai.holdout_v5 import claim_run, review_policy_matches, validate_run
from studyflow_ai.providers import prompts
from studyflow_ai.providers.live import RETRYABLE
from studyflow_ai.providers.rules import RuleProvider
from studyflow_ai.regression_run import claim_regression


def review_valid(path, manifest):
    if not path:
        return False
    review = json.loads(Path(path).read_text(encoding="utf-8"))
    return bool(
        review.get("reviewer")
        and review.get("reviewed_at")
        and review.get("approved") is True
        and review.get("dataset_sha256") == manifest["sha256"]
        and review.get("review_type") in {"human", "user_delegated_ai"}
        and (manifest.get("version") != "copilot-holdout-v5" or review_policy_matches(review, manifest))
    )


# A run of consecutive cases whose calls exhausted retries on transient provider errors
# means the provider is down: stop the paid run instead of scoring an outage as failures.
OUTAGE_CASE_LIMIT = 5


def _outage_case(row):
    return any(c["error_code"] in RETRYABLE for c in row["calls"])


def _run_arm(run_case, cases, progress):
    """Run cases in order; returns (rows, tripped). After the breaker trips, cases not yet
    started are skipped and never reach a provider."""
    stop, lock, streak = threading.Event(), threading.Lock(), [0]

    def guarded(case):
        if stop.is_set():
            return None
        row = run_case(case)
        # Counted in completion order so the breaker sees failures as soon as workers do.
        with lock:
            streak[0] = streak[0] + 1 if _outage_case(row) else 0
            if streak[0] >= OUTAGE_CASE_LIMIT:
                stop.set()
        return row

    rows = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for row in pool.map(guarded, cases):
            if row is not None:
                rows.append(row)
                progress(len(rows))
    return rows, stop.is_set()


def evaluate(
    dataset,
    settings,
    split="dev",
    review=None,
    progress=None,
    arms=None,
    evaluation_kind="frozen_test",
    run_output=None,
):
    cases, manifest = load_cases(dataset, split)
    if manifest.get("version") == "copilot-holdout-v5" and split != "test":
        raise ValueError("v5 requires the complete test split")
    approved = review_valid(review, manifest)
    review_record = json.loads(Path(review).read_text(encoding="utf-8")) if review else {}
    validate_run(dataset, manifest, settings, review_record, arms, evaluation_kind)
    if split == "test" and settings.mode == "live" and not approved:
        raise ValueError(
            "Human or explicitly user-delegated label approval is required before the live test"
        )
    provenance = None
    if manifest.get("version") == "copilot-holdout-v5" and evaluation_kind == "regression":
        provenance = claim_regression(dataset, manifest, (settings, run_output))
    classifier, llm = providers(settings)
    rules = RuleProvider()
    configurations = {"rules": (rules, rules), "llm_only": (llm, llm), "jev_llm": (classifier, llm)}
    # Datasets frozen before the v4 protocol keep the legacy gate; nothing is re-judged.
    acceptance = manifest.get("acceptance", "legacy")
    if acceptance not in {"legacy", "role-v1"}:
        raise ValueError(f"Unknown acceptance protocol: {acceptance}")
    report = dict(
        schema_version="copilot-eval-v1",
        evaluation_kind=evaluation_kind,
        acceptance=acceptance,
        prompt_version=prompts.VERSION,
        prompt_sha256=hashlib.sha256(
            (prompts.CLASSIFY + prompts.EXTRACT + prompts.PLAN).encode()
        ).hexdigest(),
        mode=settings.mode,
        split=split,
        timestamp=datetime.now(timezone.utc).isoformat(),
        dataset=manifest,
        human_reviewed=approved and review_record.get("review_type") == "human",
        review=review_record,
        run_provenance=provenance,
        live_acceptance=False,
        provider_outage=None,
        arms={},
        cost={"currency": None, "amount": None, "reason": "No verified provider tariff configured"},
    )
    try:
        if evaluation_kind == "frozen_test":
            claim_run(dataset, manifest)
        for name, pair in configurations.items():
            if arms and name not in arms:
                continue

            def run_case(case, pair=pair):
                row = evaluate_case(StudyFlowAI(*pair, DemoBackend()), case, manifest.get("scoring_policy", "complete_only"))
                row["language"] = case["language"]
                return row

            def report_progress(done, name=name):
                if progress:
                    progress(name, done, len(cases))

            rows, outage = _run_arm(run_case, cases, report_progress)
            metrics = summarize(rows)
            metrics["role"] = ARM_ROLES[name]
            metrics["legacy_targets_met"] = legacy_targets_met(metrics)
            metrics["role_targets_met"] = role_targets_met(metrics, ARM_ROLES[name])
            metrics["targets_met"] = arm_targets_met(metrics, manifest) and not outage
            report["arms"][name] = {"metrics": metrics, "cases": rows}
            if outage:
                pending = [a for a in configurations if a not in report["arms"] and (not arms or a in arms)]
                report["provider_outage"] = {
                    "arm": name,
                    "consecutive_case_limit": OUTAGE_CASE_LIMIT,
                    "samples_planned": len(cases),
                    "samples_run": len(rows),
                    "samples_skipped": len(cases) - len(rows),
                    "arms_not_run": pending,
                }
            if progress:
                progress(name, len(rows), len(cases), report)
            if outage:
                break
    finally:
        for provider in {id(p): p for p in (classifier, llm)}.values():
            provider.close()
    report["live_acceptance"] = bool(
        settings.mode == "live"
        and split == "test"
        and approved
        and len(report["arms"]) == 3
        and all(a["metrics"]["targets_met"] for a in report["arms"].values())
    )
    report["independent_frozen_test_passed"] = (
        report["live_acceptance"] and evaluation_kind == "frozen_test"
    )
    for arm in report["arms"].values():
        plans = [p for row in arm["cases"] for p in row["plans"]]
        arm["metrics"]["plan_candidate_count"] = len(plans)
        for status in ("VALID", "CONDITIONAL", "INVALID"):
            arm["metrics"]["plan_" + status.lower() + "_rate"] = (
                sum(p.get("validation") == status for p in plans) / len(plans) if plans else None
            )
    return report
