import json

import pytest

from studyflow_ai.config import Settings
from studyflow_ai.readiness.evaluation import evaluate, load_cases


def test_readiness_dataset_is_family_split_and_mock_not_live_acceptance():
    dev, manifest = load_cases("evals/readiness/cases.jsonl", "dev")
    test, _ = load_cases("evals/readiness/cases.jsonl", "test")
    assert len(dev) == 16 and len(test) == 32
    assert not {c["family"] for c in dev} & {c["family"] for c in test}
    assert not manifest["human_reviewed"]
    result = evaluate("evals/readiness/cases.jsonl", Settings(mode="mock"), "test")
    assert result["case_pass_rate"] == 1
    assert not result["live_acceptance"]


def test_modified_readiness_dataset_rejected(tmp_path):
    (tmp_path / "cases.jsonl").write_text("{}\n")
    (tmp_path / "manifest.json").write_text(json.dumps({"sha256": "wrong"}))
    with pytest.raises(ValueError, match="frozen manifest"):
        load_cases(tmp_path / "cases.jsonl", "test")
