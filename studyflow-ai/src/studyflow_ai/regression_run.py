"""One-shot regression provenance, independent of immutable first-run records."""

import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from studyflow_ai.holdout_v5 import ROOT
from studyflow_ai.providers import prompts


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _first_report(dataset):
    result = json.loads(dataset.with_name("first-run.result.json").read_text(encoding="utf-8"))
    path = (dataset.parent / result["report"]).resolve()
    if not path.is_relative_to(ROOT) or digest(path) != result["report_sha256"]:
        raise ValueError("Original first-run report changed")
    return path


def _code_hashes():
    folders = (ROOT / "studyflow-ai/src", ROOT / "backend/finance", ROOT / "scripts")
    return {path.relative_to(ROOT).as_posix(): digest(path)
            for folder in folders for path in sorted(folder.rglob("*.py"))}


def claim_regression(dataset, manifest, configuration):
    settings, output = configuration
    if output is None:
        raise ValueError("v5 regression requires a unique output directory")
    dataset, output = Path(dataset).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError("Regression output already exists")
    if output.parent.is_relative_to(dataset.parent):
        raise ValueError("Regression output must be outside the frozen dataset")
    first_report = _first_report(dataset)
    record = {
        "evaluation_kind": "regression", "rounds_per_arm": 1,
        "arms": ["rules", "llm_only", "jev_llm"],
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "dataset_sha256": manifest["sha256"], "model_configuration": asdict(settings),
        "prompt_version": prompts.VERSION, "code_sha256": _code_hashes(),
        "first_report_sha256": digest(first_report),
        "frozen_artifact_sha256": {
            path.relative_to(dataset.parent).as_posix(): digest(path)
            for path in dataset.parent.rglob("*") if path.is_file()
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with (output.parent / "run.claim.json").open("x", encoding="utf-8") as handle:
            json.dump(record, handle, ensure_ascii=False, indent=2)
    except FileExistsError:
        raise ValueError("Regression directory already claimed; no automatic paid rerun") from None
    return record
