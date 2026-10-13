// Real Django/PostgreSQL: compare a cheaper-housing scenario on the what-if page, apply it with the confirmation
// token, then explain the comparison. Setup mirrors backend/auto_test/test_copilot.py (semester + demo initialize,
// then only housing applicable at 7,000 THB/month).
import { test } from '@playwright/test';
// Retired 2026-10-13: the tool no longer opens in the workspace (navigation.ts sends its links to the main
// conversation or to monthly spending). Kept until the module source is removed.
test.skip(true, "tool retired from the workspace");
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const END = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 60); return d.toISOString().slice(0, 10); })();

test('real Django what-if: compare, apply with confirmation, explain.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const name = `copilot-uat-${randomUUID()}`;
  const password = randomUUID();
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.contrib.auth import get_user_model; get_user_model().objects.create_user(username=os.environ["UAT_NAME"],password=os.environ["UAT_PASSWORD"])'],
    { cwd: backend, env: { ...process.env, UAT_NAME: name, UAT_PASSWORD: password }, stdio: 'pipe' });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  const errors = [];
  async function ok(path, body) {
    const identity = await (await context.request.get(`${origin}/api/auth/session/`)).json();
    const response = body === undefined ? await context.request.get(`${origin}/api/v2/${path}`)
      : await context.request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + '/?copilot=1')}`);
    await page.getByLabel('Username').fill(name);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();

    await ok('readiness/semesters/', { reserve: '1000.00', opening_balance: '10000.00', as_of: TODAY });
    const state = await ok('readiness/state/');
    await ok('demo/initialize/', { state_version: state.state_version });
    // Same fixture as test_copilot.py: a fixed semester window with housing as the only applicable cost.
    execFileSync(python, ['manage.py', 'shell', '-c', [
      'import os', 'from finance.readiness.models import Semester',
      's = Semester.objects.get(owner__username=os.environ["UAT_NAME"])',
      's.draft["profile"].update(start_date=os.environ["UAT_START"], end_date=os.environ["UAT_END"])',
      'for c in s.draft["costs"]:',
      '    c.update(conflict=False, source_refs=[], confidence_type="UNCONFIRMED")',
      '    c.update(amount="7000.00", lower=None, upper=None, period="monthly", paid=False, applicability="APPLICABLE", locked=False) if c["cost_id"] == "housing" else c.update(applicability="NOT_APPLICABLE", applicability_reason="Fixture")',
      's.save()'].join('\n')],
      { cwd: backend, env: { ...process.env, UAT_NAME: name, UAT_START: TODAY, UAT_END: END }, stdio: 'pipe' });

    await page.reload();
    await page.getByRole('heading', { name: 'Compare plans' }).waitFor();
    await page.getByText(/Comparing against plan versions/).waitFor();
    const form = page.locator('fieldset.copilot-form').first();
    await form.getByLabel('Scenario name').fill('Cheaper housing');
    await form.getByRole('button', { name: 'Add cost change' }).click();
    await form.getByRole('combobox', { name: /^Cost/ }).selectOption('housing');
    await form.getByText('Current: THB 7,000.00 / month').waitFor();
    await form.getByLabel('New amount (THB)').fill('4000');
    await form.getByLabel('Effective from').fill(TODAY);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.getByText('Comparison ready. Nothing in your plan has changed.').waitFor();
    const results = page.locator('#copilot-results');
    await results.getByRole('columnheader', { name: 'Cheaper housing' }).waitFor();
    await results.locator('.copilot-better').first().waitFor();
    await results.getByRole('button', { name: /All measures/ }).click();
    await page.getByRole('dialog').getByRole('row', { name: /Remaining expenses/ }).locator('.copilot-better').waitFor();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Preview applying' }).click();
    const apply = page.locator('#copilot-apply');
    await apply.getByText(/Housing is revised to THB 4,000.00/).waitFor();
    await apply.getByLabel('I confirm applying exactly these changes to my plan.').check();
    await page.getByRole('button', { name: 'Apply to my plan' }).click();
    await page.getByText('Scenario applied to your plan. No money moved.').waitFor();
    await apply.getByText(/Plan state version \d+ → \d+/).waitFor();
    // Applying changed the plan, so the comparison is now stale.
    await page.getByRole('tab', { name: 'Compare' }).click();
    await results.getByText(/these figures are out of date/).waitFor();

    // "Why these results?" opens the explanation with this comparison's reference filled in.
    await page.getByRole('button', { name: /Why these results/ }).click();
    const why = page.locator('#copilot-why');
    await why.getByRole('heading', { name: 'Calculation engine' }).waitFor();
    await why.locator('article', { has: page.getByRole('heading', { name: 'Calculation engine' }) }).getByText('Ran', { exact: true }).waitFor();
    await page.screenshot({ path: screenshot('copilot-integration.png'), fullPage: true });
    const wallet = await ok('demo/wallets/');
    assert.equal((wallet.results ?? wallet)[0].balance, '10000.00');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
