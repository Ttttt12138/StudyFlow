"""Complete recorded live-model acceptance, only in Django's isolated test database."""
import json
import os
import subprocess
import time
from pathlib import Path
from unittest import skipUnless
from urllib.request import urlopen

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import LiveServerTestCase, override_settings

from finance import execution_services
from finance.services import save_state
from auto_test.test_short_planning_browser import ShortPlanningBrowserTests


@skipUnless(os.environ.get("RUN_FULL_LIVE_DEMO") == "1", "Opt-in full live recording")
class FullLiveDemoTests(LiveServerTestCase):
    def test_complete_recording(self):
        self.assertTrue(settings.DATABASES["default"]["NAME"].startswith("test_"))
        with override_settings(STUDYFLOW_AI_MODE="live", STUDYFLOW_FX_LIVE=False,
                               STUDYFLOW_SIMULATED_APPROVAL_SECONDS=0):
            self.run_recording()

    def seed(self):
        from finance.corridors import ensure_default_corridors
        from finance.policy_defaults import ensure_default_limits
        ensure_default_corridors()
        ensure_default_limits()
        password = "isolated-full-recording-17"
        for name in ("short-desktop", "full-operator", "full-approver"):
            user = get_user_model().objects.create_user(name, password=password, is_staff=name != "short-desktop")
            if name == "short-desktop":
                state = save_state(user, 0, {"currency": "THB", "as_of": "2027-08-01",
                    "opening_balance": "0.00", "reserve": "0.00", "events": []})
                execution_services.initialize(user, {"state_version": state.version})
        return password

    def run_recording(self):
        root = Path(__file__).resolve().parents[2]
        output = Path(os.environ["FULL_DEMO_OUTPUT"]).resolve()
        self.assertFalse((output / "model-trace.json").exists(), "Keep every attempt")
        output.mkdir(parents=True, exist_ok=True)
        port = os.environ.get("SHORT_TEST_PORT", "5201")
        env = {**os.environ, "STUDYFLOW_API_URL": self.live_server_url, "SHORT_TEST_MODE": "live",
               "SHORT_TEST_URL": f"http://127.0.0.1:{port}", "SHORT_TEST_PASSWORD": self.seed(),
               "SHORT_TEST_RECORD_VIDEO": "1", "FULL_DEMO": "1"}
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        frontend = root / "frontend"
        with (output / "vite.log").open("w", encoding="utf-8") as log:
            server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--port", port],
                cwd=frontend, env=env, stdout=log, stderr=log, creationflags=flags)
            try:
                self.wait_server(env["SHORT_TEST_URL"], server)
                with (output / "browser.log").open("w", encoding="utf-8") as browser_log:
                    run = subprocess.run(["node", "auto_test/short-planning.browser.mjs"], cwd=frontend,
                        env=env, stdout=browser_log, stderr=browser_log, timeout=3600,
                        creationflags=flags, check=False)
                self.assertEqual(run.returncode, 0, str(output / "browser.log"))
                self.assertEqual(len(json.loads((output / "browser.json").read_text())["journeys"]), 1)
            finally:
                ShortPlanningBrowserTests.record_model_trace(self, output)
                server.terminate()
                server.wait(timeout=15)

    def wait_server(self, url, process):
        for _ in range(60):
            try:
                with urlopen(url, timeout=1):
                    return
            except OSError:
                self.assertIsNone(process.poll(), "Vite stopped")
                time.sleep(0.5)
        self.fail("Vite did not start")
