import { openOpsItem } from '../../operations-support.mjs';
// Real Django/PostgreSQL: a simulated loan from quote to first repayment. The student quotes, applies and
// repays on the loans page; the operator disburses in the console. Only the month-by-month affordability
// figures are entered over the API (the page's editor has its own mocked spec).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const NEXT_MONTH = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
const SNAPSHOT = { currency: 'THB', as_of: TODAY, opening_balance: '80000.00', reserve: '15000.00', events: [] };

test('real Django loan: quote, affordable application, operator disbursement, demo clock, repayment with password.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `loan-uat-${randomUUID()}`, operator: `operator-${randomUUID()}` };
  const passwords = { student: randomUUID(), operator: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_limits()'],
    { cwd: backend, env: { ...process.env, UAT_NAMES: JSON.stringify(names), UAT_PASSWORDS: JSON.stringify(passwords) }, stdio: 'pipe' });
  const contexts = {}, errors = [];
  async function login(kind, next) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    contexts[kind] = context;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + next)}`);
    await page.getByLabel('Username').fill(names[kind]);
    await page.getByLabel('Password').fill(passwords[kind]);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    return page;
  }
  async function ok(kind, path, body) {
    const identity = await (await contexts[kind].request.get(`${origin}/api/auth/session/`)).json();
    const response = body === undefined ? await contexts[kind].request.get(`${origin}/api/v2/${path}`)
      : await contexts[kind].request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }

  try {
    const loans = await login('student', '/?loans=1');
    await ok('student', 'state/', { expected_version: 0, snapshot: SNAPSHOT });
    await ok('student', 'demo/initialize/', { state_version: 1 });
    await loans.reload();
    await loans.getByRole('heading', { name: 'My loans', exact: true }).waitFor();

    // Quote in the UI: 12,000 THB at 8% over 3 months.
    await loans.getByRole('tab', { name: 'Quote' }).click();
    await loans.getByRole('button', { name: /^(Adjust terms|Create loan quote)$/ }).click();
    const terms = loans.getByRole('dialog', { name: 'Quote terms' });
    await terms.getByLabel('Principal THB').fill('12000');
    await terms.getByLabel('Annual interest rate %').fill('8');
    await terms.getByLabel('Fees THB').fill('0');
    await terms.getByLabel('Months', { exact: true }).fill('3');
    await terms.getByLabel('First due date').fill(NEXT_MONTH);
    await terms.getByRole('button', { name: 'Create loan quote' }).click();
    await loans.getByText('Loan quote created. Review it below, then apply with it.').waitFor();

    // Affordability figures for every repayment month (over the API), then apply and submit in the UI.
    const quote = (await ok('student', 'loans/')).results[0];
    const months = [...new Set(quote.result.repayments.map(row => row.due_date.slice(0, 7)))]
      .map(month => ({ month, income: '30000.00', living_expenses: '12000.00', existing_repayments: '0.00' }));
    const profile = await ok('student', 'affordability-profile/');
    await ok('student', 'affordability-profile/', { expected_version: profile.version ?? 0, months });
    await loans.reload();
    await loans.getByRole('button', { name: 'Apply with this quote' }).click();
    await loans.getByText('Simulated application draft created.').waitFor();
    await loans.getByLabel(/I understand this is a simulated application/).check();
    await loans.getByRole('button', { name: 'Submit simulated application' }).click();
    await loans.getByText('Application submitted. Status: Approved.').waitFor();

    // Operator disburses in the console.
    const ops = await login('operator', '/?ops=1');
    await ops.getByLabel('Student', { exact: true }).fill(names.student);
    const application = await openOpsItem(ops, 'loan');
    await application.getByRole('button', { name: 'Disburse' }).click();
    await application.getByRole('button', { name: 'Confirm' }).click();
    await ops.getByText('Disbursed. The student now has an active loan account.').waitFor();

    // Student: move the demo date to the first due date and repay with the password (T2).
    await loans.reload();
    await loans.getByText(/Not due yet on the demo clock/).waitFor();
    await loans.getByRole('button', { name: /^Demo date / }).click();
    await loans.getByLabel('I understand this changes the simulated date for my demo account only.').check();
    await loans.getByRole('button', { name: /^Move demo date to / }).click();
    await loans.getByLabel(/I confirm repaying /).check();
    await loans.getByRole('button', { name: 'Repay installment 1' }).click();
    await loans.getByLabel('Password', { exact: true }).fill(passwords.student);
    await loans.getByRole('button', { name: 'Confirm', exact: true }).click();
    await loans.getByText(/Installment 1 repaid/).waitFor();
    await loans.screenshot({ path: screenshot('loans-repaid.png'), fullPage: true });

    const account = (await ok('student', 'loan-accounts/')).results[0];
    assert.equal(account.installments.find(row => row.number === 1).status, 'PAID');
    const audit = (await ok('student', 'audit/')).results.map(row => row.action);
    assert.ok(audit.includes('auth.step_up_granted'), 'repayment step-up missing from the audit log');
    assert.deepEqual(errors, []);
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
