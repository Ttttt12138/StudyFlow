// Shared settings for the browser suites. The repository keeps frontend/ (A),
// backend/ (B) and studyflow-ai/ (C) side by side.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const backend = `${root}backend`;
// Python that has the backend requirements installed; defaults to the repository's .venv.
export const python = process.env.PYTHON
  || `${root}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
// Without CHROMIUM_PATH, Playwright uses the browser from `npx playwright install`.
export const executablePath = process.env.CHROMIUM_PATH || undefined;
export const outputDir = process.env.STUDYFLOW_TEST_OUTPUT || `${root}output/frontend`;
export const screenshot = name => {
  mkdirSync(outputDir, { recursive: true });
  return `${outputDir}/${name}`;
};

// The wallet, payments, insights and trust tools open only after enrollment (src/workspace/navigation.ts).
// Gives each student an enrolled plan at the first catalog school, without bills, so a suite that is about
// one of those tools starts inside it.
const ENROLL = `import json, os
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone
from finance.planning import catalog, services
for name in json.loads(os.environ["UAT_ENROLL"]):
    user = get_user_model().objects.get(username=name)
    services.save_plan(user, {"school_key": catalog.schools()[0].key})
    plan = services.plan_for(user)
    now = timezone.now()
    plan.snapshot = services.estimate(services.entry_or_404(plan.school_key), plan.years)
    plan.start_date = (now - timedelta(days=30)).date()
    plan.status, plan.confirmed_at, plan.enrolled_at = "ENROLLED", now, now
    plan.save()`;
export const enroll = (...usernames) => execFileSync(python, ['manage.py', 'shell', '-c', ENROLL],
  { cwd: backend, env: { ...process.env, UAT_ENROLL: JSON.stringify(usernames) }, stdio: 'pipe' });
