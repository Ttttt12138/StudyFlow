"""Freeze reproducible inputs and run the current formal film in a fresh test database."""
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
BASE = ROOT / "evidence/demo-current-live-20261015"


def sources():
    names = subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "backend", "frontend",
                                     "studyflow-ai", "scripts"], cwd=ROOT, text=True, encoding="utf-8").splitlines()
    for name in sorted(set(names)):
        path = Path(name)
        if path.name.startswith(".env") or "credentials" in path.name.lower():
            continue
        if path.suffix in {".py", ".ts", ".tsx", ".mjs", ".js", ".json", ".css", ".html", ".svg",
                           ".toml", ".yaml", ".yml", ".txt", ".po", ".mo"} and (ROOT / path).is_file():
            yield name, (ROOT / path).read_bytes()


def freeze(folder):
    folder.mkdir(parents=True, exist_ok=False)
    manifest = {}
    with zipfile.ZipFile(folder / "accepted-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in sources():
            archive.writestr(name, content)
            manifest[name] = hashlib.sha256(content).hexdigest()
    (folder / "source-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    baseline = {"commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "files": len(manifest), "runtime": "working tree, hashes checked again after recording",
                "transactions": "simulated", "secrets_included": False}
    (folder / "baseline.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")


def run(take):
    folder = BASE / take
    freeze(folder)
    load_dotenv(ROOT / "backend/.env")
    load_dotenv(ROOT / "studyflow-ai/.env")
    env = {**os.environ, "DB_TEST_NAME": "test_studyflow_film_20261015_" + take.replace("-", "_"),
           "RUN_FORMAL_LIVE_DEMO": "1", "FORMAL_DEMO_OUTPUT": str(folder), "FORMAL_DEMO_PORT": "5205",
           "PYTHONDONTWRITEBYTECODE": "1", "STUDYFLOW_THROTTLE_AGENT": "300/hour",
           "STUDYFLOW_THROTTLE_STEP_UP": "120/hour", "STUDYFLOW_THROTTLE_LOGIN": "60/hour",
           "CHROMIUM_PATH": r"C:\Program Files\Google\Chrome\Application\chrome.exe"}
    with (folder / "django.log").open("w", encoding="utf-8") as log:
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", "manage.py", "test",
                                 "auto_test.test_formal_demo_browser", "--noinput", "--verbosity", "2"],
                                cwd=ROOT / "backend", env=env, stdout=log, stderr=log, check=False)
    expected = json.loads((folder / "source-manifest.json").read_text(encoding="utf-8"))
    changed = [name for name, content in sources() if expected.get(name) != hashlib.sha256(content).hexdigest()]
    (folder / "source-check.json").write_text(json.dumps({"unchanged": not changed, "changed": changed}, indent=2), encoding="utf-8")
    print(json.dumps({"returncode": result.returncode, "source_unchanged": not changed, "evidence": str(folder)}))
    raise SystemExit(result.returncode or bool(changed))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("take")
    run(parser.parse_args().take)
