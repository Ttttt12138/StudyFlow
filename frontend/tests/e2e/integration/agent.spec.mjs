// Real Django/PostgreSQL, mock planner, fixture FX; disposable users, operator-assisted setup only.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { root, outputDir, backend, python } from '../../support.mjs';

const SNAPSHOT = { currency: 'THB', as_of: new Date().toISOString().slice(0, 10), opening_balance: '80000.00', reserve: '15000.00', events: [] };

test('real Django agent: plan, T2 proposal with step-up, T3 proposal through a separate approver, trust center and audit log.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `agent-uat-${randomUUID()}`, operator: `operator-${randomUUID()}`, approver: `approver-${randomUUID()}` };
  const passwords = { student: randomUUID(), operator: randomUUID(), approver: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; from finance.corridors import ensure_default_corridors; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_corridors(); ensure_default_limits()'],
    { cwd: backend, env: { ...process.env, UAT_NAMES: JSON.stringify(names), UAT_PASSWORDS: JSON.stringify(passwords) }, stdio: 'pipe' });
  const contexts = {}, errors = [], endpoints = new Set();
  async function login(kind, next = '/?agent=1') {
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

    // T2: the assistant prepares and proposes; nothing moves until the student re-enters the password.
    await page.getByRole('heading', { name: 'Finance assistant' }).waitFor();
    const confirmTab = () => page.getByRole('tab', { name: /^To confirm/ }).click();
    const ask = async goal => { await page.getByRole('tab', { name: 'Ask' }).click(); await page.getByLabel('Your request').fill(goal);
      await page.getByRole('button', { name: 'Ask the assistant' }).click(); };
    const reopen = async goal => { await page.getByRole('button', { name: /^Recent conversations/ }).click();
      await page.locator('#agent-history').getByRole('button', { name: goal, exact: true }).click(); await confirmTab(); };
    await page.getByRole('button', { name: 'Send 5000 CNY to my THB wallet and compare the routes' }).click();
    await page.getByRole('button', { name: 'Ask the assistant' }).click();
    await page.getByText('Waiting for your confirmation').waitFor({ timeout: 60_000 });
    await confirmTab();
    const first = page.getByRole('article', { name: 'Submit transfer' });
    await first.getByText('Waiting for you').waitFor({ timeout: 60_000 });
    await first.getByText('CNY 5,000.00').waitFor();
    const firstSession = (await get('agent/sessions/')).results[0];
    await page.reload();
    await reopen(firstSession.goal);
    await first.getByText('Waiting for you').waitFor();
    assert.equal((await get(`agent/sessions/${firstSession.id}/`)).pending_actions[0].id, firstSession.pending_actions[0].id);
    await page.getByRole('tab', { name: 'Steps' }).click();
    assert.match(await page.locator('.agent-steps').innerText(), /T1[\s\S]*Prepare a transfer order[\s\S]*T2[\s\S]*Propose submitting a transfer[\s\S]*Proposed/);
    assert.equal(await cny(), '40000.00');
    await confirmTab();
    await first.getByRole('button', { name: 'Confirm with password' }).click();
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Authorize and confirm' }).click();
    await page.getByRole('dialog', { name: 'Review and confirm' }).getByText('That password was not accepted.', { exact: false }).waitFor();
    assert.equal(await cny(), '40000.00');
    await page.getByLabel('Password').fill(passwords.student);
    await page.getByRole('button', { name: 'Authorize and confirm' }).click();
    await page.getByText('Confirmed. Django executed the action', { exact: false }).waitFor();
    assert.equal(await cny(), '35000.00');

    // A fresh HTTP confirmation of the already executed action cannot debit twice.
    const replay = await post(`agent/pending-actions/${firstSession.pending_actions[0].id}/confirm/`, {});
    assert.equal(replay.status, 'CONFIRMED');
    assert.equal(await cny(), '35000.00');

    // T3: over the per-transaction limit, the confirm is refused until a separate operator approves.
    await ask('Send 15000 CNY to THB and compare the routes');
    await page.getByText('Waiting for your confirmation').waitFor({ timeout: 60_000 });
    await confirmTab();
    await page.getByRole('heading', { name: 'Waiting for your decision' }).waitFor();
    const second = page.getByRole('article', { name: 'Submit transfer' });
    await second.getByText('CNY 15,000.00').waitFor();
    await second.getByRole('button', { name: 'Confirm with password' }).click();
    await page.getByLabel('Password').fill(passwords.student);
    await page.getByRole('button', { name: 'Authorize and confirm' }).click();
    await page.getByRole('dialog', { name: 'Review and confirm' }).getByRole('heading', { name: 'Operator approval required' }).waitFor();
    assert.equal(await cny(), '35000.00');
    await page.getByLabel('Reason for the request').fill('Spring tuition');
    await page.getByRole('button', { name: 'Request operator approval' }).click();
    await second.getByText('Operator approval: Waiting for an operator').waitFor();
    const approval = (await get('approvals/?status=PENDING', 'approver')).results.find(row => row.amount === '15000.00' && row.owner);
    assert.ok(approval, 'the approver sees the pending request');
    await post(`approvals/${approval.id}/decide/`, { decision: 'approve', note: 'UAT', expected_version: approval.version }, 'approver');
    // The card may already show the decision (it refreshes approvals); the button only remains while pending.
    const check = second.getByRole('button', { name: 'Check approval status' });
    if (await check.count()) await check.click();
    await second.getByText('Operator approval: Approved').waitFor();
    await second.getByRole('button', { name: 'Confirm with password' }).click();
    await page.getByLabel('Password').fill(passwords.student);
    await page.getByRole('button', { name: 'Authorize and confirm' }).click();
    await page.getByText('Confirmed. Django executed the action', { exact: false }).waitFor();
    assert.equal(await cny(), '20000.00');
    mkdirSync(`${outputDir}`, { recursive: true });
    await page.screenshot({ path: `${outputDir}/agent-live-desktop.png`, fullPage: true });

    // Rejection survives reload and never spends. Expiry uses this student's disposable row only.
    const rejectedGoal = 'Send 1000 CNY to THB and compare the routes';
    await ask(rejectedGoal);
    await page.getByText('Waiting for your confirmation').waitFor({ timeout: 60_000 });
    await confirmTab();
    await second.getByText('Waiting for you').waitFor();
    await second.getByRole('button', { name: /Reject/ }).click();
    await second.getByText('Rejected', { exact: true }).waitFor();
    await page.reload();
    await reopen(rejectedGoal);
    await second.getByText('Rejected', { exact: true }).waitFor();
    assert.equal(await cny(), '20000.00');
    const expiryGoal = 'Send 1100 CNY to THB and compare the routes';
    await ask(expiryGoal);
    await page.getByText('Waiting for your confirmation').waitFor({ timeout: 60_000 });
    await confirmTab();
    await second.getByText('Waiting for you').waitFor();
    const expiring = (await get('agent/sessions/')).results.find(row => row.goal === expiryGoal);
    execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.utils import timezone; from datetime import timedelta; from finance.agent_models import AgentPendingAction; assert AgentPendingAction.objects.filter(pk=os.environ["UAT_ACTION"],owner__username=os.environ["UAT_USERNAME"],status="PENDING").update(expires_at=timezone.now()-timedelta(seconds=1)) == 1'],
      { cwd: backend, env: { ...process.env, UAT_ACTION: expiring.pending_actions[0].id, UAT_USERNAME: names.student }, stdio: 'pipe' });
    const expired = await post(`agent/pending-actions/${expiring.pending_actions[0].id}/confirm/`, {});
    assert.equal(expired.status, 'EXPIRED');
    await page.reload();
    await reopen(expiryGoal);
    await second.getByText('Expired', { exact: true }).waitFor();
    assert.equal(await cny(), '20000.00');

    // Trust center: tiers, limits with usage, the used approval and the audit trail of both decisions.
    await page.goto(`${origin}/?trust=1`);
    await page.getByRole('heading', { name: 'Permissions & activity' }).waitFor();
    await page.getByRole('tab', { name: 'Limits' }).click();
    const limits = page.locator('#trust-limits');
    if (await limits.getByRole('button', { name: 'CNY', exact: true }).count()) await limits.getByRole('button', { name: 'CNY', exact: true }).click();
    await limits.locator('.panel-hero', { hasText: 'CNY 10,000.00' }).waitFor();
    await limits.getByText(/CNY 20,000\.00 of CNY 20,000\.00/).first().waitFor();
    await page.locator('#trust-approvals li', { hasText: /Submit transfer.*CNY 15,000\.00.*Used/ }).waitFor();
    await page.getByRole('tab', { name: 'Activity' }).click();
    let audit = '';
    for (let n = 0; n < 12; n++) {
      audit += await page.locator('#trust-audit').innerText();
      const next = page.locator('#trust-audit').getByRole('button', { name: 'Next', exact: true });
      if (!(await next.count()) || await next.isDisabled()) break;
      await next.click();
    }
    for (const event of ['Password re-check failed', 'Password re-check passed', 'Approval requested', 'Approval granted by an operator', 'Assistant proposal confirmed'])
      assert.match(audit, new RegExp(event));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${outputDir}/trust-live-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    writeFileSync(`${outputDir}/agent-integration.json`, JSON.stringify({
      passed: true, tested_at: new Date().toISOString(), planner: 'mock (RuleAgentProvider)', fx: 'fixture',
      checks: ['T2 proposal does not move money', 'wrong password refused and audited', 'step-up confirm executes once', 'T3 proposal refused until a separate approver decides', 'approval consumed on confirm', 'limits and audit visible in trust center'],
      additional_checks: ['pending proposal restored from server after reload', 'fresh HTTP repeat confirmation does not debit twice', 'rejection persists after reload', 'expired proposal cannot execute and remains expired after reload'],
      cny_balances: ['40000.00', '35000.00', '20000.00'], endpoints: [...endpoints].sort(),
    }, null, 2));
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
