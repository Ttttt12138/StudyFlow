// Real Django/PostgreSQL: an student with a submitted application pays the study plan's bills from the wallet's Pay tab
// (src/wallet/PlanBillsPay.tsx). A short bill is topped up in its row and paid after the password (T2); a bill over
// the per-transaction limit first needs a separate operator's approval (T3), which an approver gives over HTTP.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot, submittedPlan } from '../../support.mjs';

// Two DUE bills on the student's confirmed plan and a THB wallet holding 30,000.
const SETUP = `import json, os
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone
from finance import execution_services
from finance.planning import services
from finance.planning.models import PlanBill
from finance.services import save_state
user = get_user_model().objects.get(username=os.environ["UAT_NAME"])
plan = services.plan_for(user)
due = timezone.localdate() + timedelta(days=10)
for source, kind, label, amount in json.loads(os.environ["UAT_BILLS"]):
    PlanBill.objects.create(owner=user, plan=plan, kind=kind, source_id=source, label={"en": label, "zh": label},
                            due_date=due, amount=amount, currency="THB")
state = save_state(user, 0, {"currency": "THB", "as_of": timezone.localdate().isoformat(), "opening_balance": "30000.00",
                             "reserve": "0.00", "events": []})
execution_services.initialize(user, {"state_version": state.version})`;

test('real Django bill payments: top-up in place, password step-up, operator approval, balances and audit.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `pay-uat-${randomUUID()}`, approver: `approver-${randomUUID()}` };
  const passwords = { student: randomUUID(), approver: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_limits()'],
    { cwd: backend, env: { ...process.env, UAT_NAMES: JSON.stringify(names), UAT_PASSWORDS: JSON.stringify(passwords) }, stdio: 'pipe' });
  submittedPlan(names.student);
  const bills = [['uat-housing', 'housing', 'Housing deposit', '41000.00'], ['uat-tuition', 'tuition', 'Tuition per semester', '60000.00']];
  execFileSync(python, ['manage.py', 'shell', '-c', SETUP],
    { cwd: backend, env: { ...process.env, UAT_NAME: names.student, UAT_BILLS: JSON.stringify(bills) }, stdio: 'pipe' });
  const contexts = {}, errors = [], endpoints = new Set();
  async function login(kind, next) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    contexts[kind] = context;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/v2/')) endpoints.add(`${kind}: ${request.method()} ${path.replace(/[0-9a-f-]{36}/g, '{id}')}`); });
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + next)}`);
    await page.getByLabel('Username').fill(names[kind]);
    await page.getByLabel('Password').fill(passwords[kind]);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/api/auth/login'));
    return page;
  }
  async function get(path, kind = 'student') {
    const response = await contexts[kind].request.get(`${origin}/api/v2/${path}`);
    assert.equal(response.status(), 200, `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }
  async function post(path, body, kind) {
    const identity = await (await contexts[kind].request.get(`${origin}/api/auth/session/`)).json();
    const response = await contexts[kind].request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }
  const thb = async () => (await get('demo/wallets/balances/')).balances.find(row => row.currency === 'THB').balance;
  const status = async label => (await get('planning/wallet-bills/')).bills.find(row => row.label.en === label).status;
  try {
    const page = await login('student', '/?tool=wallet&section=pay');
    await login('approver', '/');
    const pay = page.locator('.plan-bills-pay').first();
    const dialog = page.getByRole('dialog', { name: 'Review and confirm' });
    assert.equal(await thb(), '30000.00');

    // Short by 11,000: "Top up" opens a form in the row with the missing amount filled in.
    const housing = pay.locator('.plan-bills-list li', { hasText: 'Housing deposit' });
    await housing.getByText('Wallet: THB 30,000.00').waitFor();
    await housing.getByRole('button', { name: 'Top up', exact: true }).click();
    assert.equal(await housing.getByLabel('Amount (THB)').inputValue(), '11000.00');
    await housing.getByRole('button', { name: 'Top up THB 11,000.00', exact: true }).click();
    await pay.getByText('Topped up THB 11,000.00. You can now pay Housing deposit.').waitFor();
    assert.equal(await thb(), '41000.00');
    // Within the limit (T2): the password is asked for, and a wrong one moves nothing.
    await housing.getByRole('button', { name: 'Pay from wallet' }).click();
    await dialog.getByRole('heading', { name: /Confirm with your password/ }).waitFor();
    await dialog.getByLabel('Password').fill('not-the-password');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await status('Housing deposit'), 'DUE');
    await dialog.getByLabel('Password').fill(passwords.student);
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await pay.getByText('Paid Housing deposit: THB 41,000.00 (simulated).').waitFor();
    assert.equal(await status('Housing deposit'), 'PAID');
    assert.equal(await thb(), '0.00');
    await page.screenshot({ path: screenshot('bill-pay-integration-paid.png'), fullPage: true });

    // Over the per-transaction limit (T3): the student asks for approval; a separate operator decides.
    const tuition = pay.locator('.plan-bills-list li', { hasText: 'Tuition per semester' });
    await tuition.getByRole('button', { name: 'Top up', exact: true }).click();
    await tuition.getByRole('button', { name: 'Top up THB 60,000.00', exact: true }).click();
    await pay.getByText('Topped up THB 60,000.00. You can now pay Tuition per semester.').waitFor();
    await tuition.getByRole('button', { name: 'Pay from wallet' }).click();
    await dialog.getByRole('heading', { name: /Operator approval needed/ }).waitFor();
    await dialog.getByRole('button', { name: 'Request approval' }).click();
    // Without the demo's simulated operator (CI), real staff decide and the dialog closes.
    await page.getByText('Approval requested. Come back after an operator decides.').waitFor();
    assert.equal(await status('Tuition per semester'), 'DUE');
    const approval = (await get('approvals/?status=PENDING', 'approver')).results.find(row => row.action === 'bill.pay' && row.amount === '60000.00');
    assert.ok(approval, 'the approver sees the pending bill payment');
    await post(`approvals/${approval.id}/decide/`, { decision: 'approve', note: 'UAT', expected_version: approval.version }, 'approver');
    await tuition.getByRole('button', { name: 'Pay from wallet' }).click();
    await dialog.getByRole('heading', { name: /Confirm with your password/ }).waitFor();
    await dialog.getByLabel('Password').fill(passwords.student);
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await pay.getByText('Paid Tuition per semester: THB 60,000.00 (simulated).').waitFor();
    await pay.getByText('Everything due is paid.').waitFor();
    assert.equal(await status('Tuition per semester'), 'PAID');
    assert.equal(await thb(), '0.00');

    // The approval was used once, and the audit trail records both password checks and the decision.
    assert.equal((await get('approvals/')).results.find(row => row.id === approval.id).status, 'USED');
    const audit = (await get('audit/')).results.map(row => row.action);
    for (const action of ['auth.step_up_failed', 'auth.step_up_granted', 'approval.requested', 'approval.approved'])
      assert.ok(audit.includes(action), `audit has ${action}`);
    await page.screenshot({ path: screenshot('bill-pay-integration-approved.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
