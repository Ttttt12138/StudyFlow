"""Archive public acceptance artifacts; exclude browser traces and session secrets."""
import hashlib
import importlib.metadata
import json
import platform
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence/verification-20261011"


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, encoding="utf-8").strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    public = OUT / "artifacts"
    public.mkdir(exist_ok=True)
    shutil.copytree(ROOT / "output/gates", public / "gates", dirs_exist_ok=True)
    for name in ("copilot-v1", "copilot-holdout-v2", "copilot-holdout-v3"):
        latest = max(OUT.glob(f"regression-{name}-*.json"), key=lambda p: p.stat().st_mtime_ns)
        shutil.copy2(latest, public / f"regression-{name}-final.json")
    frontend = ROOT / "output/frontend"
    for name in ["integration.json", "agent-integration.json", "wallet-integration.json"]:
        path = frontend / name
        if path.exists():
            shutil.copy2(path, public / name)
    for pattern in ["agent-live*.png", "trust-live*.png", "integration-*.png", "dashboard-*.png", "wallet-live*.png"]:
        for path in frontend.glob(pattern):
            shutil.copy2(path, public / path.name)
    for replay in (1, 2, 3):
        source = frontend / f"reference-{replay}"
        target = public / source.name
        target.mkdir(exist_ok=True)
        for pattern in ["*.json", "*.png"]:
            for path in source.glob(pattern):
                shutil.copy2(path, target / path.name)
        # Earlier failed debugging videos remain in ignored output/, not in the delivery set.
        latest = max(source.glob("*.webm"), key=lambda p: p.stat().st_mtime_ns)
        shutil.copy2(latest, target / "accepted-replay.webm")
    files = command("git", "ls-files", "--cached", "--others", "--exclude-standard").splitlines()
    files = [p for p in files if not p.startswith(("evidence/", "open-active-theory/")) and (ROOT / p).is_file()]
    fingerprint = {"timestamp": datetime.now(timezone.utc).isoformat(), "commit": command("git", "rev-parse", "HEAD"),
                   "files_sha256": {p: digest(ROOT / p) for p in files},
                   "status": command("git", "status", "--porcelain=v1")}
    (OUT / "final-code-fingerprint.json").write_text(json.dumps(fingerprint, ensure_ascii=False, indent=2), encoding="utf-8")
    environment = {"python": platform.python_version(), "host": platform.platform(),
                   "packages": {p: importlib.metadata.version(p) for p in ("Django", "djangorestframework", "pytest", "pydantic", "ruff")},
                   "node": command("node", "--version"), "npm": command("npm.cmd", "--version"),
                   "docker": command("docker", "version", "--format", "{{.Server.Version}}"),
                   "compose": command("docker", "compose", "version", "--short"),
                   "postgres": command("docker", "exec", "studyflow-verification-20261011-db-1", "psql", "-U", "studyflow", "-Atc", "select version()"),
                   "models": "mock", "fx": "fixture", "origin": "http://127.0.0.1:8088"}
    (OUT / "environment.json").write_text(json.dumps(environment, indent=2), encoding="utf-8")
    artifacts = {p.relative_to(OUT).as_posix(): {"sha256": digest(p), "bytes": p.stat().st_size} for p in OUT.rglob("*") if p.is_file() and p.name != "artifact-index.json"}
    (OUT / "artifact-index.json").write_text(json.dumps(artifacts, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Archived {len(artifacts)} public artifacts; {len(files)} source fingerprints; browser traces excluded")


if __name__ == "__main__":
    main()
