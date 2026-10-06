"""Keep frozen copies of runtime files recorded by the Copilot holdout protocols.

The holdout protocols pin the exact code used for their blind runs. When a pinned
file changes, its HEAD version (the pinned one) must be stored under
evals/<holdout>/frozen/<path>.txt. Run this before committing changes to finance/.
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


def main():
    missing = []
    for protocol_path in sorted(EVALS.glob("copilot-holdout-*/protocol.json")):
        folder = protocol_path.parent
        protocol = json.loads(protocol_path.read_text(encoding="utf-8"))
        for path, digest in protocol.get("code_sha256", {}).items():
            current = ROOT / path
            if current.exists() and _matches(current.read_bytes(), digest):
                continue
            frozen = folder / "frozen" / (path + ".txt")
            if frozen.exists() and _matches(frozen.read_bytes(), digest):
                continue
            head = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=ROOT,
                                  capture_output=True).stdout
            if _matches(head, digest):
                frozen.parent.mkdir(parents=True, exist_ok=True)
                frozen.write_bytes(head)
                print(f"froze {folder.name}: {path}")
            else:
                missing.append(f"{folder.name}: {path}")
    for item in missing:
        print(f"MISSING pinned version: {item}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
