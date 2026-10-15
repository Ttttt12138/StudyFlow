// Real API, deterministic planner, isolated PostgreSQL: user-entered amount through signing and repayment.
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

test('real loan journey: amount, estimate, application, automatic notice, signing and repayment', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const username = `loan-flow-${randomUUID()}`, password = randomUUID();
  execFileSync(python, ['manage.py', 'shell', '-c',
    'import os; from django.contrib.auth import get_user_model; from finance.policy_defaults import ensure_default_limits; get_user_model().objects.create_user(os.environ["UAT_USER"],password=os.environ["UAT_PASS"]); ensure_default_limits()'],
    { cwd: backend, env: { ...process.env, UAT_USER: username, UAT_PASS: password }, stdio: 'pipe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const get = async path => {
    const r = await context.request.get(`${origin}/api/v2/${path}`);
    assert.equal(r.status(), 200, await r.text()); return (await r.json()).data;
  };
  const post = async (path, body) => {
    const session = await (await context.request.get(`${origin}/api/auth/session/`)).json();
    const r = await context.request.post(`${origin}/api/v2/${path}`, { data: body,
      headers: { 'X-CSRFToken': session.csrf_token, 'Idempotency-Key': randomUUID() } });
    assert.ok([200, 201].includes(r.status()), await r.text()); return (await r.json()).data;
  };
  try {
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + '/')}`);
    await page.getByLabel('Username').fill(username); await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.locator('.plan-composer textarea')).toBeEnabled();
    await expect.poll(async () => (await get('agent/conversations/')).length).toBeGreaterThan(0);
    const conversation = (await get('agent/conversations/'))[0];
    await post(`agent/conversations/${conversation.id}/choose/`, { school_key: 'psu-phuket' });
    await page.goto(`${origin}/?tool=funding`);
    const panel = page.locator('.assessment-panel');
    await expect(panel.getByRole('button', { name: 'Estimate repayments', exact: true })).toBeDisabled();
    await panel.getByRole('spinbutton', { name: 'Loan amount', exact: true }).fill('48000');
    await panel.getByRole('radio', { name: /Commercial study loan/ }).click();
    await panel.getByRole('button', { name: 'Estimate repayments', exact: true }).click();
    await panel.getByRole('button', { name: 'Confirm plan and apply', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm plan and apply', exact: true }).click();
    const notice = panel.getByRole('checkbox', { name: /Simulated admission notice/ });
    await expect(notice).toBeChecked(); await expect(notice).toBeDisabled();
    let data = await get('planning/assessment/');
    assert.equal(data.plan.status, 'CONFIRMED'); assert.equal(data.lifecycle.applications.length, 1);
    assert.equal(data.lifecycle.applications[0].status, 'APPROVED');
    assert.equal(data.quotes[0].inputs.principal, '48000.00');
    const tools = page.getByRole('navigation', { name: 'Tools' });
    await expect(tools.getByRole('button', { name: 'Wallet & payments', exact: true })).toBeVisible();
    for (const doc of data.loan_stage.documents.filter(d => !d.auto)) {
      await post('planning/loan/documents/', { task_id: doc.id, expected_version: doc.version, done: true });
    }
    await page.reload();
    await panel.getByRole('button', { name: 'Sign the loan', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign the loan', exact: true }).click();
    await expect(panel.locator('.loan-stage-payouts')).toBeVisible();
    data = await get('planning/assessment/');
    assert.equal(data.loan_stage.signed, true);
    assert.equal(data.lifecycle.accounts.length, 1);
    const first = data.lifecycle.accounts[0].installments[0];
    await post('demo/wallets/top-up/', { currency: 'THB', amount: '10000.00' });
    await post('planning/life/clock/', { date: first.due_on });
    await page.reload();
    await panel.getByRole('button', { name: 'Confirm repayment', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm repayment', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Password').fill(password);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(async () => (await get('planning/assessment/')).lifecycle.accounts[0].installments[0].status).toBe('PAID');
    await page.screenshot({ path: screenshot('simplified-real-loan-repayment.png') });
    for (const path of ['family-links/', 'in-school/', 'expenses/', 'credit/']) {
      assert.equal((await context.request.get(`${origin}/api/v2/planning/${path}`)).status(), 404);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
