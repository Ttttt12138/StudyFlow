"""Local rule regressions on prior datasets; never calls a model provider."""

import json
from datetime import datetime, timezone
from pathlib import Path

from studyflow_ai.config import Settings
from studyflow_ai.copilot_evaluation import evaluate

ROOT = Path(__file__).resolve().parents[1]


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder = ROOT / "evidence/verification-20261011" / ("v5-prior-regressions-" + stamp)
    folder.mkdir()
    for name in ("copilot-v1", "copilot-holdout-v2", "copilot-holdout-v3"):
        report = evaluate(ROOT / "studyflow-ai/evals" / name / "cases.jsonl",
                          Settings(mode="mock"), "dev" if name == "copilot-v1" else "test",
                          arms=["rules"], evaluation_kind="regression")
        (folder / (name + ".json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        metrics = report["arms"]["rules"]["metrics"]
        print(name, json.dumps({k: metrics[k] for k in (
            "samples", "classification_accuracy", "joint_field_accuracy", "wrong_auto_decisions",
            "critical_silent_misses", "provider_errors",
        )}))
    print(folder)


if __name__ == "__main__":
    main()
