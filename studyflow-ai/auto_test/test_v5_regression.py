import json
from pathlib import Path

import pytest

from studyflow_ai.config import Settings
from studyflow_ai.holdout_v5 import validate_run

DATA = Path(__file__).resolve().parents[1] / "evals/copilot-holdout-v5"


def records():
    return (json.loads((DATA / "manifest.json").read_text(encoding="utf-8")),
            json.loads((DATA / "review.json").read_text(encoding="utf-8")))


def test_regression_accepts_changed_code_but_keeps_frozen_run_blocked():
    manifest, review = records()
    validate_run(DATA / "cases.jsonl", manifest, Settings(mode="live"), review, None, "regression")
    with pytest.raises(ValueError, match="Frozen code changed|already claimed"):
        validate_run(DATA / "cases.jsonl", manifest, Settings(mode="live"), review, None, "frozen_test")


@pytest.mark.parametrize("change", [{"thresholds": {}}, {"scoring_policy": "complete_only"}])
def test_regression_cannot_change_scoring(change):
    manifest, review = records()
    with pytest.raises(ValueError, match="acceptance configuration"):
        validate_run(DATA / "cases.jsonl", {**manifest, **change}, Settings(mode="live"),
                     review, None, "regression")


def test_regression_cannot_change_model_or_approval():
    manifest, review = records()
    with pytest.raises(ValueError, match="model configuration"):
        validate_run(DATA / "cases.jsonl", manifest, Settings(mode="live", openai_model="other"),
                     review, None, "regression")
    with pytest.raises(ValueError, match="human-reviewed"):
        validate_run(DATA / "cases.jsonl", manifest, Settings(mode="live"),
                     {**review, "dataset_sha256": "bad"}, None, "regression")


def test_regression_claim_is_separate_and_single_use(tmp_path):
    from studyflow_ai.regression_run import claim_regression

    manifest, _ = records()
    original = (DATA / "first-run.claim.json").read_bytes()
    output = tmp_path / "run" / "report.json"
    metadata = claim_regression(DATA / "cases.jsonl", manifest, (Settings(mode="live"), output))
    assert metadata["dataset_sha256"] == manifest["sha256"]
    assert metadata["code_sha256"] and metadata["first_report_sha256"]
    assert (output.parent / "run.claim.json").is_file()
    assert (DATA / "first-run.claim.json").read_bytes() == original
    with pytest.raises(ValueError, match="claimed"):
        claim_regression(DATA / "cases.jsonl", manifest, (Settings(mode="live"), output))


def test_regression_refuses_existing_output(tmp_path):
    from studyflow_ai.regression_run import claim_regression

    manifest, _ = records()
    output = tmp_path / "report.json"
    output.write_text("original", encoding="utf-8")
    with pytest.raises(ValueError, match="exists"):
        claim_regression(DATA / "cases.jsonl", manifest, (Settings(mode="live"), output))
    assert output.read_text() == "original"
