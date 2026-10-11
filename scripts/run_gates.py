"""Run the shared verification gates and fail on the first broken one.

Usage (from the workspace root):
    studyFlow/Scripts/python.exe scripts/run_gates.py [--skip-demos] [--only NAME ...]

Logs go to output/gates/<name>.log. Set DB_TEST_NAME per worktree when
several checkouts share one PostgreSQL server.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
B_DIR = ROOT / "backend"
C_DIR = ROOT / "studyflow-ai"
OUT = ROOT / "output" / "gates"

GATES = [
    # Archives holdout-pinned files that changed; fails if a pinned version is unrecoverable.
    ("holdout-freeze", [PY, "scripts/freeze_holdout_code.py"], ROOT),
    ("check", [PY, "manage.py", "check"], B_DIR),
    # Message catalogs match the code, are fully translated and compiled (docs/i18n.md).
    ("i18n", [PY, "scripts/i18n_messages.py", "check"], B_DIR),
    ("migrations", [PY, "manage.py", "makemigrations", "--check", "--dry-run"], B_DIR),
    ("django-tests", [PY, "manage.py", "test", "finance", "auto_test", "--noinput", "--keepdb"], B_DIR),
    ("openapi", [PY, "manage.py", "spectacular", "--validate", "--fail-on-warn",
                 "--file", str(OUT / "openapi.yaml")], B_DIR),
    ("c-ruff", [PY, "-m", "ruff", "check", "src", "auto_test", "scripts"], C_DIR),
    # The default pytest temp dir is not writable in some sandboxes.
    ("c-tests", [PY, "-m", "pytest", "-p", "no:cacheprovider",
                 f"--basetemp={ROOT / 'output' / 'pytest-tmp'}"], C_DIR),
    ("migrate", [PY, "manage.py", "migrate", "--noinput"], B_DIR),
    # Throttle counters live in the database cache (docs/permissions.md §6).
    ("cache-table", [PY, "manage.py", "createcachetable"], B_DIR),
]
DEMOS = [
    ("demo-bc", ["demo_bc", "--runs", "3"]),
    ("demo-readiness", ["demo_readiness", "--mode", "mock", "--runs", "3"]),
    ("demo-consumption", ["demo_consumption", "--runs", "3"]),
    ("demo-copilot", ["demo_copilot", "--mode", "mock", "--runs", "3"]),
    ("demo-remittance", ["demo_remittance", "--runs", "3"]),
    ("demo-agent", ["demo_agent", "--runs", "3"]),
    ("eval-agent", ["evaluate_agent", "--mode", "mock", "--min-success", "1.0"]),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-demos", action="store_true")
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    gates = list(GATES)
    if not args.skip_demos:
        gates += [(name, [PY, "manage.py", *cmd, "--output", str(OUT / f"{name}.json")], B_DIR)
                  for name, cmd in DEMOS]
    if args.only:
        gates = [g for g in gates if g[0] in args.only]
    for name, cmd, cwd in gates:
        # Some demo commands refuse to overwrite an existing report.
        (OUT / f"{name}.json").unlink(missing_ok=True)
        started = time.monotonic()
        log = OUT / f"{name}.log"
        with log.open("w", encoding="utf-8") as handle:
            code = subprocess.call(cmd, cwd=cwd, stdout=handle, stderr=subprocess.STDOUT)
        print(f"{'PASS' if code == 0 else 'FAIL'} {name} ({time.monotonic() - started:.0f}s)")
        if code:
            print(f"see {log.relative_to(ROOT)}")
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())
