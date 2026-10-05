import json
from pathlib import Path

import pytest

from studyflow_ai.config import Settings
from studyflow_ai.evaluation import evaluate, load_cases

DATA = Path(__file__).resolve().parents[1] / "evals" / "cases.jsonl"


def test_frozen_splits_and_no_leakage():
    dev, _ = load_cases(DATA, "dev")
    test, _ = load_cases(DATA, "test")
    assert len(dev) == 40 and len(test) == 80
    assert not {c["family"] for c in dev} & {c["family"] for c in test}
    assert not any(c["human_reviewed"] for c in dev + test)


def test_modified_dataset_rejected(tmp_path):
    target = tmp_path / "cases.jsonl"
    target.write_bytes(DATA.read_bytes() + b"\n")
    target.with_name("manifest.json").write_bytes(DATA.with_name("manifest.json").read_bytes())
    with pytest.raises(ValueError, match="frozen manifest"):
        load_cases(target, "test")


def test_smoke_never_claims_live_acceptance():
    report = evaluate(DATA, Settings(mode="mock"), "dev")
    assert report["live_acceptance"] is False
    assert set(report["arms"]) == {"rules", "llm_only", "jev_llm"}
    assert report["arms"]["jev_llm"]["metrics"]["acceptance_targets_met"] is None
    json.dumps(report)
