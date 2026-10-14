// Real Django/PostgreSQL, mock planner, fixture FX; disposable users, operator-assisted setup only.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { root, outputDir, backend, python, enroll } from '../../support.mjs';

const SNAPSHOT = { currency: 'THB', as_of: new Date().toISOString().slice(0, 10), opening_balance: '80000.00', reserve: '15000.00', events: [] };

test('real Django agent: plan, T2 proposal with step-up, T3 proposal through a separate approver, credit record and audit log.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `agent-uat-${randomUUID()}`, operator: `operator-${randomUUID()}`, approver: `approver-${randomUUID()}` };
  const passwords = { student: randomUUID(), operator: randomUUID(), approver: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; from finance.corridors import ensure_default_corridors; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_corridors(); ensure_default_limits()'],
    { cwd: backend, env: { ...process.env, UAT_NAMES: JSON.stringify(names), UAT_PASSWORDS: JSON.stringify(passwords) }, stdio: 'pipe' });
  enroll(names.student);
  const contexts = {}, errors = [], endpoints = new Set();
  async function login(kind, next = '/') {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    contexts[kind] = context;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) endpoints.add(`${kind}: ${request.method()} ${path}`); });
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + next)}`);
    await page.getByLabel('Username').fill(names[kind]);
    await page.getByLabel('Password').fill(passwords[kind]);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    return page;
  }
  async function get(path, kind = 'student') {
    const response = await contexts[kind].request.get(`${origin}/api/v2/${path}`);
    assert.equal(response.status(), 200, `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }
  async function post(path, body, kind = 'student') {
    const identity = await (await contexts[kind].request.get(`${origin}/api/auth/session/`)).json();
    const response = await contexts[kind].request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }
  const cny = async () => (await get('demo/wallets/balances/')).balances.find(row => row.currency === 'CNY')?.balance ?? '0.00';
  try {
    const page = await login('student');
    await login('operator', '/');
    await login('approver', '/');
    await post('state/', { expected_version: 0, snapshot: SNAPSHOT });
    await post('demo/initialize/', { state_version: 1 });
    const source = await post('funding-sources/', { economic_key: `family-cny-${randomUUID()}`, kind: 'external_savings', currency: 'CNY', amount: '40000.00', available_on: SNAPSHOT.as_of, certainty: 'confirmed' });
    await post(`funding-sources/${source.id}/receive/`, { hold_in_source_currency: true }, 'operator');
    assert.equal(await cny(), '40000.00');

    // Money moves through the planner conversation: the assistant proposes a transfer as a confirmation card,
    // and nothing moves until the student re-enters the password in the card's dialog (T2).
    const chat = page.locator('#plan-chat');
    const cards = page.locator('.plan-card-confirm');
    const dialog = page.getByRole('dialog', { name: 'Review and confirm' });
    const ask = async goal => {
      await chat.getByLabel('Message the assistant').fill(goal);
      await chat.getByLabel('Message the assistant').press('Enter');
    };
    const confirmWith = async (card, password) => {
      await card.getByRole('button', { name: 'Review and confirm' }).click();
      await dialog.getByLabel('Password').fill(password);
      await dialog.getByRole('button', { name: 'Authorize and confirm' }).click();
    };
    const session = async goal => (await get('agent/sessions/')).results.find(row => row.goal === goal);
    const firstGoal = 'Send 5000 CNY to my THB wallet and compare the routes';
    await ask(firstGoal);
    const first = cards.nth(0);
    await first.getByRole('heading', { name: 'Submit transfer' }).waitFor({ timeout: 60_000 });
    await first.getByText('Waiting for you', { exact: true }).waitFor();
    const firstSession = await session(firstGoal);
    assert.ok(firstSession, 'the proposal is a stored agent session');
    assert.equal(await cny(), '40000.00');
    // The pending proposal is restored from the server after a reload.
    await page.reload();
    await first.getByText('Waiting for you', { exact: true }).waitFor();
    assert.equal((await get(`agent/sessions/${firstSession.id}/`)).pending_actions[0].id, firstSession.pending_actions[0].id);
    await confirmWith(first, 'not-the-password');
    await dialog.getByText('That password was not accepted.', { exact: false }).waitFor();
    assert.equal(await cny(), '40000.00');
    await dialog.getByLabel('Password').fill(passwords.student);
    await dialog.getByRole('button', { name: 'Authorize and confirm' }).click();
    await page.getByText('Confirmed. Django executed the action', { exact: false }).waitFor();
    await first.getByText('Confirmed', { exact: true }).waitFor();
    assert.equal(await cny(), '35000.00');

    // A fresh HTTP confirmation of the already executed action cannot debit twice.
    const replay = await post(`agent/pending-actions/${firstSession.pending_actions[0].id}/confirm/`, {});
    assert.equal(replay.status, 'CONFIRMED');
    assert.equal(await cny(), '35000.00');

    // T3: over the per-transaction limit, the confirm is refused until a separate operator approves.
    await ask('Send 15000 CNY to THB and compare the routes');
    const second = cards.nth(1);
    await second.getByText('Waiting for you', { exact: true }).waitFor({ timeout: 60_000 });
    await confirmWith(second, passwords.student);
    await dialog.getByText('Operator approval required').waitFor();
    assert.equal(await cny(), '35000.00');
    await dialog.getByLabel('Reason for the request').fill('Spring tuition');
    await dialog.getByRole('button', { name: 'Request operator approval' }).click();
    await page.getByText('Approval requested.', { exact: false }).waitFor();
    const approval = (await get('approvals/?status=PENDING', 'approver')).results.find(row => row.amount === '15000.00' && row.owner);
    assert.ok(approval, 'the approver sees the pending request');
    await post(`approvals/${approval.id}/decide/`, { decision: 'approve', note: 'UAT', expected_version: approval.version }, 'approver');
    await confirmWith(second, passwords.student);
    await second.getByText('Confirmed', { exact: true }).waitFor();
    assert.equal(await cny(), '20000.00');
    mkdirSync(`${outputDir}`, { recursive: true });
    await page.screenshot({ path: `${outputDir}/agent-live-desktop.png`, fullPage: true });

    // Rejection survives reload and never spends. Expiry uses this student's disposable row only.
    await ask('Send 1000 CNY to THB and compare the routes');
    const third = cards.nth(2);
    await third.getByText('Waiting for you', { exact: true }).waitFor({ timeout: 60_000 });
    await third.getByRole('button', { name: 'Reject' }).click();
    await third.getByText('Rejected', { exact: true }).waitFor();
    await page.reload();
    await third.getByText('Rejected', { exact: true }).waitFor();
    assert.equal(await cny(), '20000.00');
    const expiryGoal = 'Send 1100 CNY to THB and compare the routes';
    await ask(expiryGoal);
    const fourth = cards.nth(3);
    await fourth.getByText('Waiting for you', { exact: true }).waitFor({ timeout: 60_000 });
    const expiring = await session(expiryGoal);
    execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.utils import timezone; from datetime import timedelta; from finance.agent_models import AgentPendingAction; assert AgentPendingAction.objects.filter(pk=os.environ["UAT_ACTION"],owner__username=os.environ["UAT_USERNAME"],status="PENDING").update(expires_at=timezone.now()-timedelta(seconds=1)) == 1'],
      { cwd: backend, env: { ...process.env, UAT_ACTION: expiring.pending_actions[0].id, UAT_USERNAME: names.student }, stdio: 'pipe' });
    const expired = await post(`agent/pending-actions/${expiring.pending_actions[0].id}/confirm/`, {});
    assert.equal(expired.status, 'EXPIRED');
    await page.reload();
    await fourth.getByText('Expired', { exact: true }).waitFor();
    assert.equal(await cny(), '20000.00');

    // Credit record: limits with usage, the used approval and the audit trail of both decisions.
    await page.goto(`${origin}/?trust=1`);
    await page.getByRole('heading', { name: 'Credit record' }).waitFor();
    await page.getByRole('tab', { name: 'Limits' }).click();
    const limits = page.locator('#trust-limits');
    const cnyButton = limits.getByRole('button', { name: 'CNY', exact: true });
    await cnyButton.waitFor();
    await cnyButton.click();
    await limits.locator('.panel-hero', { hasText: 'CNY 10,000.00' }).waitFor();
    await limits.getByText(/CNY 20,000\.00 of CNY 20,000\.00/).first().waitFor();
    await page.locator('#trust-approvals li', { hasText: /Submit transfer.*CNY 15,000\.00.*Used/ }).waitFor();
    await page.getByRole('tab', { name: 'Activity' }).click();
    const audit = page.locator('#trust-audit');
    await audit.locator('tbody tr').first().waitFor();
    // Five events a page; each category's list is short enough to read on its first page.
    const expected = { 'Sign-in & step-up': ['Password re-check failed', 'Password re-check passed'],
      Approvals: ['Approval requested', 'Approval granted by an operator'], 'AI assistant': ['Assistant proposal confirmed'] };
    for (const [category, names] of Object.entries(expected)) {
      await audit.getByLabel('Show').selectOption({ label: category });
      for (const name of names) await audit.locator('tbody tr', { hasText: name }).first().waitFor();
    }
    await audit.getByLabel('Show').selectOption('all');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${outputDir}/trust-live-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    writeFileSync(`${outputDir}/agent-integration.json`, JSON.stringify({
      passed: true, tested_at: new Date().toISOString(), planner: 'mock (RuleAgentProvider)', fx: 'fixture',
      checks: ['T2 proposal in the conversation does not move money', 'wrong password refused and audited', 'step-up confirm executes once', 'T3 proposal refused until a separate approver decides', 'approval consumed on confirm', 'limits and audit visible in the credit record'],
      additional_checks: ['pending proposal restored from server after reload', 'fresh HTTP repeat confirmation does not debit twice', 'rejection persists after reload', 'expired proposal cannot execute and remains expired after reload'],
      cny_balances: ['40000.00', '35000.00', '20000.00'], endpoints: [...endpoints].sort(),
    }, null, 2));
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
