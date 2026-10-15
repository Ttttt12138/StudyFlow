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

// A submitted application fixture for money-tool suites, without pre-funding their wallets.
// The complete API submission and signing journey is covered by integration/plan.spec.mjs.
const APPLY = `import json, os
from django.contrib.auth import get_user_model
from django.utils import timezone
from finance.planning import catalog, services
from finance.workflow_models import LoanSimulation, SimulatedApplication
for name in json.loads(os.environ["UAT_APPLY"]):
    user = get_user_model().objects.get(username=name)
    services.save_plan(user, {"school_key": catalog.schools()[0].key})
    plan = services.plan_for(user)
    loan = LoanSimulation.objects.create(owner=user, inputs={}, result={})
    SimulatedApplication.objects.create(owner=user, loan=loan, status="APPROVED")
    plan.loan = loan
    plan.snapshot = services.estimate(services.entry_or_404(plan.school_key), plan.years)
    plan.status, plan.confirmed_at = "CONFIRMED", timezone.now()
    plan.save()`;
export const submittedPlan = (...usernames) => execFileSync(python, ['manage.py', 'shell', '-c', APPLY],
  { cwd: backend, env: { ...process.env, UAT_APPLY: JSON.stringify(usernames) }, stdio: 'pipe' });
