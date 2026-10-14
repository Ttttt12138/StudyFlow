"""Freeze non-secret inputs before the isolated live acceptance; keep every attempt."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def freeze(take):
    snapshot = ROOT / "output" / f"full-demo-{take}"
    evidence = ROOT / "evidence/demo-full-live-20261014" / take
    if snapshot.exists() or (evidence / "source-manifest.json").exists():
        raise SystemExit("Attempt already exists; choose a new take")
    evidence.mkdir(parents=True, exist_ok=True)
    paths = subprocess.check_output(["rg", "--files", "-g", "!**/output/**", "-g", "!**/evidence/**", "-g", "!**/node_modules/**", "backend", "frontend", "studyflow-ai", "scripts"], cwd=ROOT, text=True, encoding="utf-8").splitlines()
    manifest = {}
    with zipfile.ZipFile(evidence / "accepted-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for raw in sorted(paths):
            relative = Path(raw)
            if any(p in {"__pycache__", "node_modules", ".pytest_cache", ".ruff_cache", "dist"} for p in relative.parts):
                continue
            if relative.name.startswith(".env") or relative.suffix in {".pyc", ".mp4", ".webm"}:
                continue
            content = (ROOT / relative).read_bytes()
            target = snapshot / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            archive.writestr(relative.as_posix(), content)
            manifest[relative.as_posix()] = hashlib.sha256(content).hexdigest()
    (evidence / "source-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    (evidence / "baseline.json").write_text(json.dumps({"commit": commit, "files": len(manifest),
        "snapshot": str(snapshot), "secrets_in_archive": False}, indent=2), encoding="utf-8")
    print(json.dumps({"snapshot": str(snapshot), "evidence": str(evidence), "files": len(manifest)}))


def run(take):
    snapshot = ROOT / "output" / f"full-demo-{take}"
    evidence = ROOT / "evidence/demo-full-live-20261014" / take
    load_dotenv(ROOT / "backend/.env")
    load_dotenv(ROOT / "studyflow-ai/.env")
    env = {**os.environ, "PYTHONPATH": str(snapshot / "studyflow-ai/src"),
           "DB_TEST_NAME": f"test_studyflow_full_demo_{take.replace('-', '_')}",
           "RUN_FULL_LIVE_DEMO": "1", "FULL_DEMO_OUTPUT": str(evidence),
           "CHROMIUM_PATH": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
           "STUDYFLOW_THROTTLE_STEP_UP": "60/hour", "STUDYFLOW_THROTTLE_AGENT": "100/hour"}
    with (evidence / "django.log").open("w", encoding="utf-8") as log:
        result = subprocess.run([sys.executable, "-X", "utf8", "manage.py", "test",
            "auto_test.test_full_demo_browser.FullLiveDemoTests", "--noinput", "--verbosity", "2"],
            cwd=snapshot / "backend", env=env, stdout=log, stderr=log)
    print(json.dumps({"returncode": result.returncode, "log": str(evidence / "django.log")}))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["freeze", "run"])
    parser.add_argument("take")
    args = parser.parse_args()
    (freeze if args.action == "freeze" else run)(args.take)
