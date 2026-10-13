"""Opt-in real HTTP/PostgreSQL + Chromium journey; never uses the development database."""
import json
import os
import subprocess
import time
from pathlib import Path
from unittest import skipUnless
from urllib.request import urlopen

from django.contrib.auth import get_user_model
from django.test import LiveServerTestCase

from finance import execution_services
from finance.services import save_state


@skipUnless(os.environ.get("RUN_SHORT_PLANNING_BROWSER") == "1", "Opt-in browser acceptance")
class ShortPlanningBrowserTests(LiveServerTestCase):
    def test_desktop_and_mobile_real_api(self):
        from finance.policy_defaults import ensure_default_limits
        ensure_default_limits()
        root = Path(__file__).resolve().parents[2]
        output = root / "evidence" / os.environ.get("SHORT_TEST_EVIDENCE", "short-planning-20261013")
        output.mkdir(parents=True, exist_ok=True)
        users = get_user_model().objects
        password = "isolated-planning-browser-17"
        users.create_user("short-operator", password=password, is_staff=True)
        for name in ("short-desktop", "short-mobile"):
            user = users.create_user(name, password=password)
            state = save_state(user, 0, {"currency": "THB", "as_of": "2027-08-01",
                "opening_balance": "0.00", "reserve": "0.00", "events": []})
            execution_services.initialize(user, {"state_version": state.version})
        env = {**os.environ, "STUDYFLOW_API_URL": self.live_server_url,
               "SHORT_TEST_URL": "http://127.0.0.1:5193", "SHORT_TEST_PASSWORD": password}
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with (output / "vite.log").open("w", encoding="utf-8") as log:
            server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--port", "5193"],
                cwd=root / "frontend", env=env, stdout=log, stderr=log, creationflags=flags)
            try:
                for _ in range(60):
                    try:
                        with urlopen(env["SHORT_TEST_URL"], timeout=1):
                            break
                    except OSError:
                        if server.poll() is not None:
                            self.fail("Isolated Vite failed; see evidence/short-planning-20261013/vite.log")
                        time.sleep(0.5)
                run = subprocess.run(["node", "auto_test/short-planning.browser.mjs"], cwd=root / "frontend",
                    env=env, capture_output=True, text=True, encoding="utf-8", timeout=240, creationflags=flags, check=False)
                (output / "browser.log").write_text(run.stdout + run.stderr, encoding="utf-8")
                self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
                evidence = json.loads((output / "browser.json").read_text(encoding="utf-8"))
                self.assertEqual(len(evidence["journeys"]), 2)
            finally:
                server.terminate()
                server.wait(timeout=15)
