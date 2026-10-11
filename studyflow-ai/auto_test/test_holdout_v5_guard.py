import json
from dataclasses import asdict

import pytest

from studyflow_ai.config import Settings
from studyflow_ai.evaluation_safety import V5_SCORING_POLICY
from studyflow_ai.holdout_v5 import validate_run


def test_v5_draft_cannot_run_even_with_generic_ai_approval(tmp_path):
    dataset = tmp_path / "cases.jsonl"
    dataset.write_text("", encoding="utf-8")
    manifest = {"version": "copilot-holdout-v5", "frozen": False, "sha256": "draft"}
    review = {"approved": True, "review_type": "user_delegated_ai"}
    with pytest.raises(ValueError, match="human-reviewed frozen"):
        validate_run(dataset, manifest, Settings(mode="live"), review, None, "frozen_test")


def test_v5_requires_all_three_arms_in_one_first_run(tmp_path):
    manifest = {"version": "copilot-holdout-v5", "frozen": True, "sha256": "ok"}
    review = {"approved": True, "review_type": "human", "dataset_sha256": "ok", "reviewer": "user", "reviewed_at": "2026-10-11"}
    with pytest.raises(ValueError, match="all three arms"):
        validate_run(tmp_path / "cases.jsonl", manifest, Settings(mode="live"), review, ["rules"], "frozen_test")


def test_v5_rejects_changed_code_before_model_calls(tmp_path):
    dataset = tmp_path / "cases.jsonl"
    dataset.write_text("", encoding="utf-8")
    manifest = {"version": "copilot-holdout-v5", "frozen": True, "sha256": "ok"}
    review = {"approved": True, "review_type": "human", "dataset_sha256": "ok", "reviewer": "user", "reviewed_at": "2026-10-11"}
    (tmp_path / "protocol.json").write_text(json.dumps({"model_configuration": {"mode": "wrong"}}), encoding="utf-8")
    with pytest.raises(ValueError, match="configuration"):
        validate_run(dataset, manifest, Settings(mode="live"), review, None, "frozen_test")


@pytest.mark.parametrize("change", [{"scoring_policy": "complete_only"}, {"thresholds": {}}])
def test_v5_cannot_restore_incomplete_scoring_after_freeze(tmp_path, change):
    from studyflow_ai.holdout_v5 import acceptance_configuration

    manifest = {"version": "copilot-holdout-v5", "frozen": True, "sha256": "ok",
                "acceptance": "legacy", "require_inferred_date_safety": True,
                "scoring_policy": V5_SCORING_POLICY, "thresholds": {"joint_field_accuracy": .95}}
    review = {"approved": True, "review_type": "human", "dataset_sha256": "ok",
              "reviewer": "user", "reviewed_at": "2026-10-11"}
    protocol = {"model_configuration": asdict(Settings(mode="live")),
                "acceptance_configuration": acceptance_configuration(manifest)}
    (tmp_path / "protocol.json").write_text(json.dumps(protocol), encoding="utf-8")
    with pytest.raises(ValueError, match="acceptance configuration"):
        validate_run(tmp_path / "cases.jsonl", {**manifest, **change}, Settings(mode="live"), review, None, "frozen_test")


def test_same_labels_cannot_reuse_approval_of_an_old_scoring_policy(tmp_path):
    from studyflow_ai.copilot_evaluation import review_valid

    manifest = {"version": "copilot-holdout-v5", "sha256": "unchanged-labels", "scoring_policy": V5_SCORING_POLICY}
    review = {"approved": True, "review_type": "human", "reviewer": "user", "reviewed_at": "2026-10-11",
              "dataset_sha256": manifest["sha256"], "scoring_policy": "all_expected_with_review_v1"}
    path = tmp_path / "review.json"
    path.write_text(json.dumps(review), encoding="utf-8")
    assert not review_valid(path, manifest)
    review["scoring_policy"] = V5_SCORING_POLICY
    path.write_text(json.dumps(review), encoding="utf-8")
    assert review_valid(path, manifest)
