"""Freeze v5 only after the user has reviewed and approved its exact label hash."""
import argparse
import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from studyflow_ai.config import Settings, load_env_file
from studyflow_ai.evaluation_safety import V5_SCORING_POLICY
from studyflow_ai.holdout_v5 import acceptance_configuration, review_policy_matches

ROOT = Path(__file__).resolve().parent.parent
FOLDER = ROOT / "studyflow-ai/evals/copilot-holdout-v5"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--env-file", type=Path, default=ROOT / "studyflow-ai/.env")
    args = parser.parse_args()
    manifest = json.loads((FOLDER / "manifest.json").read_text(encoding="utf-8"))
    review = json.loads(args.review.read_text(encoding="utf-8"))
    digest = hashlib.sha256((FOLDER / "cases.jsonl").read_bytes()).hexdigest()
    if manifest.get("frozen") or (FOLDER / "protocol.json").exists():
        raise SystemExit("Already frozen; preserve the existing first-run protocol")
    if manifest.get("scoring_policy") != V5_SCORING_POLICY:
        raise SystemExit("v5 requires one-to-one event matching and date/review safety scoring")
    if not (review.get("approved") is True and review.get("review_type") == "human"
            and review.get("reviewer") and review.get("reviewed_at")
            and review_policy_matches(review, manifest)
            and review.get("dataset_sha256") == digest == manifest["sha256"]):
        raise SystemExit("User approval of the exact labels and current scoring policy is required")
    load_env_file(args.env_file)
    files = sorted((ROOT / "backend").rglob("*.py")) + sorted((ROOT / "studyflow-ai/src").rglob("*.py"))
    hashes = {}
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        hashes[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        copy = FOLDER / "frozen" / (relative + ".txt")
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(path.read_bytes())
    protocol = {"frozen_at": datetime.now(timezone.utc).isoformat(), "code_sha256": hashes,
                "model_configuration": asdict(Settings.from_env("live")), "reference_date": "2026-10-02",
                "acceptance": "legacy", "rounds_per_arm": 1, "review": review,
                "thresholds": manifest["thresholds"], "dataset_sha256": digest,
                "acceptance_configuration": acceptance_configuration(manifest)}
    (FOLDER / "protocol.json").write_text(json.dumps(protocol, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest.update(frozen=True, frozen_at=protocol["frozen_at"], human_reviewed=True)
    (FOLDER / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Frozen reviewed v5; no model calls made. Run all three arms once with evaluate_copilot.")


if __name__ == "__main__":
    main()
