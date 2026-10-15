"""Opt-in live-model film acceptance; all writes go to Django's isolated test database."""
import json
import os
import secrets
import subprocess
import time
from pathlib import Path
from unittest import skipUnless
from urllib.request import urlopen

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import LiveServerTestCase, override_settings


@skipUnless(os.environ.get("RUN_FORMAL_LIVE_DEMO") == "1", "Opt-in current live film")
class FormalDemoBrowserTests(LiveServerTestCase):
    @override_settings(STUDYFLOW_AI_MODE="live", STUDYFLOW_FX_LIVE=False,
                       STUDYFLOW_SIMULATED_APPROVAL_SECONDS=0)
    def test_current_english_student_and_operations_journey(self):
        self.assertTrue(settings.DATABASES["default"]["NAME"].startswith("test_studyflow_film_"))
        self.run_recording()

    def seed(self):
        from finance.corridors import ensure_default_corridors
        from finance.policy_defaults import ensure_default_limits
        ensure_default_corridors()
        ensure_default_limits()
        password = secrets.token_urlsafe(24)
        for role in ("student", "operator", "approver"):
            get_user_model().objects.create_user("film-" + role, password=password, is_staff=role != "student")
        return password

    def run_recording(self):
        root = Path(__file__).resolve().parents[2]
        output = Path(os.environ["FORMAL_DEMO_OUTPUT"])
        port = os.environ["FORMAL_DEMO_PORT"]
        env = {**os.environ, "STUDYFLOW_API_URL": self.live_server_url,
               "FORMAL_DEMO_URL": "http://127.0.0.1:" + port, "FORMAL_DEMO_PASSWORD": self.seed()}
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with (output / "vite.log").open("w", encoding="utf-8") as log:
            server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--port", port],
                                      cwd=root / "frontend", env=env, stdout=log, stderr=log, creationflags=flags)
            try:
                self.wait_server(env["FORMAL_DEMO_URL"], server)
                with (output / "browser.log").open("w", encoding="utf-8") as browser_log:
                    run = subprocess.run(["node", "auto_test/formal-demo/main.mjs"], cwd=root / "frontend",
                                         env=env, stdout=browser_log, stderr=browser_log,
                                         creationflags=flags, timeout=3600, check=False)
                self.assertEqual(run.returncode, 0, str(output / "browser.log"))
            finally:
                self.record_trace(output)
                server.terminate()
                server.wait(timeout=15)

    def wait_server(self, url, process):
        for _ in range(60):
            try:
                with urlopen(url, timeout=1):
                    return
            except OSError:
                self.assertIsNone(process.poll(), "Vite stopped")
                time.sleep(.5)
        self.fail("Vite did not start")

    def record_trace(self, output):
        from finance.agent_models import AgentSession
        from finance.agent_runner import session_record
        turns = [session_record(t) for t in AgentSession.objects.order_by("created_at")]
        calls = [s["call"] for t in turns for s in t["steps"]]
        modes = {mode: sum(c.get("mode", "system") == mode for c in calls)
                 for mode in sorted({c.get("mode", "system") for c in calls})}
        result = {"database": settings.DATABASES["default"]["NAME"], "turns": turns, "call_modes": modes,
                  "models": sorted({c.get("model", "") for c in calls}),
                  "live_attempts": sum(c.get("attempts", 0) for c in calls if c.get("mode") == "live")}
        (output / "model-trace.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
