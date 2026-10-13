"""Opt-in browser acceptance with real APIs and separate demo students in a test database."""
import os
import subprocess
import time
from datetime import date
from pathlib import Path
from unittest import skipUnless
from urllib.request import urlopen

from django.contrib.auth import get_user_model
from django.test import LiveServerTestCase

from finance.planning import services
from finance.planning.models import PlanningProfile


@skipUnless(os.environ.get("RUN_STUDY_LIFE_BROWSER") == "1", "Opt-in browser acceptance")
class StudyLifeBrowserTests(LiveServerTestCase):
    def test_desktop_and_mobile(self):
        root = Path(__file__).resolve().parents[2]
        output = root / "evidence/study-life-20261013"
        output.mkdir(parents=True, exist_ok=True)
        password = "isolated-study-life-17"
        for name in ("life-desktop", "life-mobile"):
            user = get_user_model().objects.create_user(name, password=password)
            services.save_plan(user, {"school_key": "psu-phuket"})
            plan = services.plan_for(user)
            plan.status, plan.start_date = "CONFIRMED", date(2027, 8, 8)
            plan.snapshot = services.estimate(services.entry_or_404(plan.school_key), plan.years)
            plan.save()
            PlanningProfile.objects.create(owner=user, demo_date=date(2027, 8, 1))
        env = {**os.environ, "STUDYFLOW_API_URL": self.live_server_url,
               "LIFE_TEST_URL": "http://127.0.0.1:5194", "LIFE_TEST_PASSWORD": password}
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with (output / "vite.log").open("w", encoding="utf-8") as log:
            server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--port", "5194"],
                cwd=root / "frontend", env=env, stdout=log, stderr=log, creationflags=flags)
            try:
                for _ in range(60):
                    try:
                        with urlopen(env["LIFE_TEST_URL"], timeout=1):
                            break
                    except OSError:
                        if server.poll() is not None:
                            self.fail("Isolated Vite failed; see study-life evidence/vite.log")
                        time.sleep(0.5)
                run = subprocess.run(["node", "auto_test/study-life.browser.mjs"], cwd=root / "frontend",
                    env=env, capture_output=True, text=True, encoding="utf-8", timeout=240, creationflags=flags, check=False)
                (output / "browser.log").write_text(run.stdout + run.stderr, encoding="utf-8")
                self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            finally:
                server.terminate()
                server.wait(timeout=15)
