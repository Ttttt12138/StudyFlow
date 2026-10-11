"""Keep frozen copies of runtime files recorded by the Copilot holdout protocols.

The holdout protocols pin the exact code used for their blind runs. When a pinned
file changes, its pinned version (found in git history) must be stored under
evals/<holdout>/frozen/<path>.txt. Run this before committing changes to backend/finance/.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVALS = ROOT / "studyflow-ai" / "evals"


def _variants(raw):
    lf = raw.replace(b"\r\n", b"\n")
    return raw, lf, lf.replace(b"\n", b"\r\n")


def _matches(raw, digest):
    return any(hashlib.sha256(data).hexdigest() == digest for data in _variants(raw))


def _current(path):
    """Protocols pinned B files by their path before B moved under backend/."""
    moved = ROOT / "backend" / path
    return moved if not (ROOT / path).exists() and moved.exists() else ROOT / path


def _pinned_from_history(path, digest):
    """Newest committed version of `path` whose content matches the pinned digest."""
    commits = subprocess.run(["git", "log", "--format=%H", "--", path], cwd=ROOT,
                             capture_output=True, text=True).stdout.split()
    for commit in commits:
        content = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT,
                                 capture_output=True).stdout
        if _matches(content, digest):
            return content
    return None


def main():
    missing = []
    for protocol_path in sorted(EVALS.glob("copilot-holdout-*/protocol.json")):
        folder = protocol_path.parent
        protocol = json.loads(protocol_path.read_text(encoding="utf-8"))
        for path, digest in protocol.get("code_sha256", {}).items():
            current = _current(path)
            if current.exists() and _matches(current.read_bytes(), digest):
                continue
            frozen = folder / "frozen" / (path + ".txt")
            if frozen.exists() and _matches(frozen.read_bytes(), digest):
                continue
            pinned = _pinned_from_history(path, digest)
            if pinned is not None:
                frozen.parent.mkdir(parents=True, exist_ok=True)
                frozen.write_bytes(pinned)
                print(f"froze {folder.name}: {path}")
            else:
                missing.append(f"{folder.name}: {path}")
    for item in missing:
        print(f"MISSING pinned version: {item}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
