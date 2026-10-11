"""Adversarial scorer fixtures, not predictions on the unreviewed holdout."""
from types import SimpleNamespace

import pytest

from studyflow_ai.evaluation import evaluate_case, legacy_targets_met, summarize
from studyflow_ai.evaluation_safety import V5_SCORING_POLICY

POLICY = V5_SCORING_POLICY
EXPECTED = {"category": "other", "amount": "100.00", "currency": "THB", "due_date": None}


class Dump:
    def __init__(self, event):
        self.event = event
        self.issues = []

    def model_dump(self, **kwargs):
        return self.event


def score(actual_date=None, status="NEEDS_REVIEW", candidate_status=None, extra=None, missing=False):
    event = {**EXPECTED, "due_date": actual_date, "status": candidate_status or status,
             "confidence_type": "EXTRACTED", "issues": [], "evidence": []}
    result = SimpleNamespace(
        candidates=[] if missing else [Dump(event), *([Dump(extra)] if extra else [])],
        status=status, calls=[], issues=[], routing=SimpleNamespace(classification=SimpleNamespace(category="other")),
    )
    ai = SimpleNamespace(ingest=lambda *args: result)
    case = {"case_id": "scorer-only", "text": "Unresolved payment deadline", "category": "other",
            "expected_events": [EXPECTED], "backend_risk": False, "important": True, "expected_review": True}
    return ai, case


@pytest.mark.parametrize("actual_date,correct", [(None, 1), ("2026-11-01", 0)])
def test_expected_null_is_a_scored_field_value(actual_date, correct):
    ai, case = score(actual_date)
    row = evaluate_case(ai, case, POLICY)
    assert row["complete_field_cases"] == 1
    assert row["correct_field_cases"] == correct
    assert row["null_date_safety_checks"] == 1
    assert row["null_date_safety_failures"] == 1 - correct


@pytest.mark.parametrize("kwargs", [
    {"status": "READY"}, {"candidate_status": "READY"}, {"missing": True},
    {"extra": {**EXPECTED, "due_date": "2026-11-01", "status": "READY"}},
])
def test_null_date_requires_review_and_no_contradictory_candidate(kwargs):
    ai, case = score(**kwargs)
    row = evaluate_case(ai, case, POLICY)
    assert row["null_date_safety_failures"] == 1
    assert "NULL_DATE_SAFETY_FAILED" in row["failure_reasons"]


@pytest.mark.parametrize("bad_count", [1, 20])
def test_wrong_date_and_auto_release_cannot_pass_final_gate(bad_count):
    from studyflow_ai.evaluation import arm_targets_met

    good = evaluate_case(*score(), POLICY)
    bad = evaluate_case(*score("2026-11-01", "READY"), POLICY)
    danger = {**good, "dangerous": True, "complete_field_cases": 0, "correct_field_cases": 0,
              "null_date_safety_checks": 0, "null_date_safety_failures": 0}
    metrics = summarize([*[good] * (150 - bad_count), *[bad] * bad_count, *[danger] * 10])
    assert metrics["joint_field_denominator"] == 150
    assert metrics["wrong_auto_decisions"] == bad_count
    if bad_count == 1:
        assert legacy_targets_met(metrics)  # Accuracy tolerance alone cannot enforce safety.
    assert not arm_targets_met(metrics, {"acceptance": "legacy", "scoring_policy": POLICY})


def test_safe_nulls_pass_and_historical_denominator_is_unchanged():
    from studyflow_ai.evaluation import arm_targets_met

    ai, case = score()
    assert evaluate_case(ai, case)["complete_field_cases"] == 0
    row = evaluate_case(ai, case, POLICY)
    metrics = summarize([row, {**row, "dangerous": True}])
    assert arm_targets_met(metrics, {"acceptance": "legacy", "scoring_policy": POLICY})


def test_unknown_scoring_policy_fails_closed():
    with pytest.raises(ValueError, match="scoring policy"):
        evaluate_case(*score(), "misspelled")


def test_three_arm_report_uses_null_scoring_and_final_safety_gate(tmp_path, monkeypatch):
    import hashlib
    import json

    from studyflow_ai import copilot_evaluation
    from studyflow_ai.config import Settings

    ai, case = score("2026-11-01", "READY")
    cases = [{**case, "family": "scorer-fixture", "split": "dev", "language": "en"}]
    raw = "\n".join(json.dumps(c) for c in cases).encode()
    (tmp_path / "cases.jsonl").write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps({
        "sha256": hashlib.sha256(raw).hexdigest(), "acceptance": "legacy", "scoring_policy": POLICY,
    }), encoding="utf-8")
    provider = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(copilot_evaluation, "providers", lambda settings: (provider, provider))
    monkeypatch.setattr(copilot_evaluation, "StudyFlowAI", lambda *args: ai)
    report = copilot_evaluation.evaluate(tmp_path / "cases.jsonl", Settings(mode="mock"))
    assert len(report["arms"]) == 3
    for arm in report["arms"].values():
        assert arm["metrics"]["joint_field_denominator"] == 1
        assert arm["metrics"]["null_date_safety_failures"] == 1
        assert not arm["metrics"]["targets_met"]
    assert not report["live_acceptance"]
