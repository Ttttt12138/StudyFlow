import hashlib
import json
from pathlib import Path

import pytest

from studyflow_ai.copilot_evaluation import review_valid
from studyflow_ai.evaluation import load_cases

ROOT = Path(__file__).resolve().parents[1]


def test_new_holdout_is_frozen_and_disjoint_from_prior_materials():
    folder = ROOT / "evals/copilot-holdout-v2"
    cases, manifest = load_cases(folder / "cases.jsonl", "test")
    old = [
        json.loads(line)
        for line in (ROOT / "evals/copilot-v1/cases.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(cases) == 160
    assert {r["language"] for r in cases} == {"en", "zh", "zh-en"}
    assert not {r["family"] for r in cases} & {r["family"] for r in old}
    assert not {r["text"] for r in cases} & {r["text"] for r in old}
    assert len({r["case_id"] for r in cases}) == 160
    assert review_valid(folder / "review.json", manifest)
    for row in cases:
        for event in row["expected_events"]:
            for key in ("amount", "currency", "due_date"):
                if event[key] is not None:
                    assert event[key] in row["text"]
        if row["dangerous"]:
            assert row["expected_review"] and not row["expected_events"]


def test_holdout_v3_is_frozen_and_disjoint_from_v1_and_v2():
    folder = ROOT / "evals/copilot-holdout-v3"
    cases, manifest = load_cases(folder / "cases.jsonl", "test")
    old = [
        json.loads(line)
        for name in ("copilot-v1", "copilot-holdout-v2")
        for line in (ROOT / "evals" / name / "cases.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(cases) == 160
    assert {r["language"] for r in cases} == {"en", "zh", "zh-en"}
    assert not {r["family"] for r in cases} & {r["family"] for r in old}
    assert not {r["text"] for r in cases} & {r["text"] for r in old}
    assert len({r["case_id"] for r in cases}) == 160
    assert review_valid(folder / "review.json", manifest)
    protocol = json.loads((folder / "protocol.json").read_text(encoding="utf-8"))
    assert protocol["rules_version"] == "rules-1.2-multilingual"
    for row in cases:
        for event in row["expected_events"]:
            for key in ("amount", "currency", "due_date"):
                if event[key] is not None:
                    assert event[key] in row["text"]
        if row["dangerous"]:
            assert row["expected_review"] and not row["expected_events"]


@pytest.mark.parametrize("version", ["v2", "v3"])
def test_blind_protocol_records_exact_runtime_code(version):
    folder = ROOT / f"evals/copilot-holdout-{version}"
    protocol = json.loads((folder / "protocol.json").read_text(encoding="utf-8"))
    assert protocol["prompt_version"] == "1.4"
    assert protocol["no_model_runs_before_freeze"] is True
    # A file changed after the first blind run must keep its frozen copy under frozen/.
    for path, digest in protocol["code_sha256"].items():
        current = ROOT.parent / path
        if not current.exists():
            # Protocols pinned B files by their path before B moved under backend/.
            current = ROOT.parent / "backend" / path
        if not current.exists() or not _matches_digest(current, digest):
            current = folder / "frozen" / (path + ".txt")
        assert _matches_digest(current, digest), path


def _matches_digest(path, digest):
    # Digests were taken from a Windows checkout with mixed line endings; git checkouts
    # normalize them per OS, so accept the raw, LF and CRLF forms of the same content.
    raw = path.read_bytes()
    lf = raw.replace(b"\r\n", b"\n")
    variants = (raw, lf, lf.replace(b"\n", b"\r\n"))
    return any(hashlib.sha256(data).hexdigest() == digest for data in variants)
