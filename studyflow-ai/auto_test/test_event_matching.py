"""Scorer-only adversarial outputs; never runs predictions on the holdout."""
from types import SimpleNamespace

import pytest

from studyflow_ai.evaluation import arm_targets_met, evaluate_case, summarize
from studyflow_ai.evaluation_safety import V5_SCORING_POLICY


def obligation(amount, **changes):
    return {"category": "utility", "amount": f"{amount:.2f}", "currency": "CNY",
            "due_date": "2026-11-10", **changes}


def evaluate_outputs(expected, actual, status="READY", policy=None):
    candidates = [SimpleNamespace(
        model_dump=lambda event=event, **kwargs: {**event, "status": status}, issues=[],
    ) for event in actual]
    result = SimpleNamespace(candidates=candidates, status=status, calls=[], issues=[],
                             routing=SimpleNamespace(classification=SimpleNamespace(category="utility")))
    ai = SimpleNamespace(ingest=lambda *args: result)
    case = {"case_id": "scorer-netting", "text": "Import 120 CNY minus export credit 30 CNY: only net 90 CNY payable.",
            "category": "utility", "expected_events": expected, "expected_review": False,
            "backend_risk": False, "important": True}
    return evaluate_case(ai, case, policy or V5_SCORING_POLICY)


def final_metrics(row):
    blocked = evaluate_outputs([], [], status="NEEDS_REVIEW")
    metrics = summarize([row, {**blocked, "dangerous": True}])
    metrics["targets_met"] = arm_targets_met(metrics, {"acceptance": "legacy", "scoring_policy": V5_SCORING_POLICY})
    return metrics


@pytest.mark.parametrize("status", ["READY", "NEEDS_REVIEW"])
def test_netting_components_cannot_be_extra_obligations(status):
    row = evaluate_outputs([obligation(90)], [obligation(90), obligation(120), obligation(30)], status)
    metrics = final_metrics(row)
    assert not metrics["targets_met"]
    assert row["unexpected_event_indices"] == [1, 2]
    assert row["event_matches"] == [{"expected_index": 0, "predicted_index": 0}]
    assert row["wrong_auto_decision"] == (status == "READY")
    assert metrics["event_precision"] == pytest.approx(1 / 3)
    assert "UNEXPECTED_EVENTS" in row["failure_reasons"]


def test_duplicate_cannot_replace_another_expected_obligation():
    row = evaluate_outputs([obligation(90), obligation(120)], [obligation(90), obligation(90)])
    assert row["correct_field_cases"] == 1
    assert not final_metrics(row)["targets_met"]
    assert row["unmatched_expected_indices"] == [1]
    assert row["unexpected_event_indices"] == [1]
    assert row["duplicate_event_indices"] == [1]
    assert "DUPLICATE_EVENTS" in row["failure_reasons"]


def test_single_actual_cannot_satisfy_two_identical_expected_events():
    row = evaluate_outputs([obligation(90), obligation(90)], [obligation(90)])
    assert row["correct_field_cases"] == 1
    assert row["unmatched_expected_indices"] == [1]
    assert not final_metrics(row)["targets_met"]


def test_duplicate_extra_fails_even_when_every_expected_field_matches():
    row = evaluate_outputs([obligation(90)], [obligation(90), obligation(90)])
    assert not final_metrics(row)["targets_met"]
    assert row["duplicate_event_indices"] == [1]


@pytest.mark.parametrize("expected,actual", [
    ([obligation(90)], [obligation(90)]),
    ([obligation(90), obligation(120)], [obligation(120), obligation(90)]),
    ([obligation(90), obligation(90)], [obligation(90), obligation(90)]),
    ([obligation(90, category="family_support")], [obligation(90, category="family_support", due_date=None, date="2026-11-10")]),
])
def test_exact_multiset_passes_regardless_of_order(expected, actual):
    row = evaluate_outputs(expected, actual)
    assert final_metrics(row)["targets_met"]
    assert row["unexpected_event_indices"] == []
    assert row["duplicate_event_indices"] == []
    assert row["correct_field_cases"] == len(expected)


def test_empty_expectation_does_not_exempt_extra_candidates():
    row = evaluate_outputs([], [obligation(90)], "NEEDS_REVIEW")
    assert row["unexpected_event_indices"] == [0]
    assert not final_metrics(row)["targets_met"]


def test_historical_protocol_keeps_its_original_matching():
    row = evaluate_outputs([obligation(90), obligation(90)], [obligation(90)], policy="complete_only")
    assert row["correct_field_cases"] == 2
