// Real Django/PostgreSQL: a synthetic student imports a bank CSV on the spending insights page and the
// semester forecast is recalculated from it. Setup (semester, demo wallet, monthly cost amounts) follows
// ConsumptionDemo.prepare_learning in backend/finance/management/commands/demo_consumption.py and runs over
// the API; the import, review, coverage declaration and confirmation go through the UI.
import { test } from '@playwright/test';
// Retired 2026-10-13: the tool no longer opens in the workspace (navigation.ts sends its links to the main
// conversation or to monthly spending). Kept until the module source is removed.
test.skip(true, "tool retired from the workspace");
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, root, python, screenshot, enroll } from '../../support.mjs';

test('real Django spending insights: CSV upload, review, complete coverage, confirm, recalculation, forecast changes.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const username = `insights-uat-${randomUUID()}`, password = randomUUID();
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.contrib.auth import get_user_model; get_user_model().objects.create_user(username=os.environ["UAT_NAME"], password=os.environ["UAT_PASSWORD"])'],
    { cwd: backend, env: { ...process.env, UAT_NAME: username, UAT_PASSWORD: password }, stdio: 'pipe' });
  enroll(username);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  const errors = [], endpoints = new Set();
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/v2/')) endpoints.add(`${request.method()} ${path.replace(/[0-9a-f-]{36}/g, '{id}')}`); });
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(`${origin}/?insights=1`)}`);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.getByRole('heading', { name: 'Spending insights', level: 2 }).waitFor();

    async function call(path, body) {
      const identity = await (await context.request.get(`${origin}/api/auth/session/`)).json();
      const response = body === undefined ? await context.request.get(`${origin}/api/v2/${path}`)
        : await context.request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
      const payload = await response.json();
      assert.ok(response.ok(), `${path}: ${JSON.stringify(payload)}`);
      return payload.data ?? payload;
    }
    const semester = await call('readiness/semesters/', { reserve: '5000', opening_balance: '65000', as_of: '2026-10-01' });
    await call('demo/initialize/', { state_version: semester.state_version });
    const draft = structuredClone(semester.draft);
    draft.profile.start_date = '2026-10-01';
    const monthly = { food: '3000.00', housing: '9000.00', communications: '500.00', transport: '1500.00' };
    for (const cost of draft.costs) {
      Object.assign(cost, { conflict: false, paid: false, synthetic: true, valid_until: null, source_refs: [], alternatives: [] });
      if (cost.cost_id === 'tuition') Object.assign(cost, { amount: '30000.00', due_date: '2026-10-10' });
      else if (cost.cost_id in monthly) Object.assign(cost, { amount: monthly[cost.cost_id], period: 'monthly', locked: cost.cost_id === 'housing' });
      else Object.assign(cost, { applicability: 'NOT_APPLICABLE', applicability_reason: 'Synthetic demonstration scope' });
    }
    const state = await call('readiness/state/');
    await call('readiness/semesters/revise/', { semester_id: state.semester_id, state_version: state.state_version, budget_version: state.budget_version, analysis_version: state.analysis_version, draft });

    // The dock header's refresh reloads the open tool; panels are tabs and the import opens in a sheet.
    const tab = name => page.getByRole('tab', { name }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
    await tab('Forecast');
    await page.locator('#insights-forecast').waitFor();

    // Upload the synthetic three-month history.
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.getByLabel('Where the file comes from').selectOption('synthetic');
    await page.getByLabel('CSV file').setInputFiles(`${root}backend/examples/consumption/v1/history.csv`);
    await page.getByRole('button', { name: 'Upload and preview' }).click();
    await page.getByText(/^File read: 99 rows to review, 0 invalid\.$/).waitFor();
    const review = page.locator('.insights-review');
    await review.getByLabel('Select all rows').check();
    await review.getByText('99 of 99 rows selected.').waitFor();
    await review.getByRole('button', { name: 'Coverage per account' }).click();
    await review.getByLabel('From', { exact: true }).fill('2026-07-01');
    await review.getByLabel('To', { exact: true }).fill('2026-09-30');
    await review.getByLabel('This file is complete for this period').check();
    await page.screenshot({ path: screenshot('insights-review.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm import' }).click();
    await page.getByText('Import confirmed: 99 rows added.').waitFor();

    // The confirm queues a readiness check; the page follows it (worker container) and reloads the briefing.
    await page.getByText(/Recalculating your forecast…|Forecast recalculated\./).waitFor();
    await page.getByText(/^(Forecast recalculated\.|The recalculation is taking longer than a minute\..*)$/).waitFor({ timeout: 90_000 });
    const recalculated = await page.getByText('Forecast recalculated.').count();
    await tab('Forecast');
    const costs = page.locator('#insights-forecast li');
    await costs.filter({ hasText: 'Housing' }).filter({ hasText: 'Not changed: contract or locked cost' }).waitFor();
    // Costs page four at a time: step through until an applied median shows.
    const applied = costs.filter({ hasText: 'Applied' }).filter({ hasText: 'Median of complete months' });
    const nextCost = page.locator('#insights-forecast').getByRole('button', { name: 'Next', exact: true });
    for (let n = 0; n < 6 && !(await applied.count()) && await nextCost.isEnabled(); n++) await nextCost.click();
    await applied.first().waitFor();
    assert.ok(await applied.count() >= 1);
    await tab('Overview');
    await page.getByRole('button', { name: 'Check history' }).click();
    await page.locator('#insights-checks').getByText('Transactions changed').first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.getByRole('dialog').getByText('Imported', { exact: true }).first().waitFor();
    await page.keyboard.press('Escape');
    await tab('Transactions');
    await page.locator('#insights-transactions').getByText('Showing 50 of 99.').waitFor();
    await page.screenshot({ path: screenshot('insights-recalculated.png'), fullPage: true });

    // The server is the source of truth: the briefing applies at least one cost, the wallet is untouched.
    const briefing = await call('readiness/briefing/');
    assert.ok(briefing.forecast_changes.costs.some(cost => cost.applied));
    assert.equal((await call('readiness/state/')).assets.wallet_balance, '65000.00');
    for (const endpoint of ['POST /api/v2/readiness/transaction-imports/', 'POST /api/v2/readiness/transaction-imports/{id}/confirm/', 'GET /api/v2/readiness/checks/', 'GET /api/v2/readiness/briefing/'])
      assert.ok(endpoints.has(endpoint), endpoint);
    assert.deepEqual(errors, []);
    test.info().annotations.push({ type: 'recalculation', description: recalculated ? 'check job finished' : 'worker slower than 60 s; briefing still recalculated' });
  } finally {
    await context.close();
  }
});
