// Real Django/PostgreSQL: the operations console. Student steps run over the API (their own pages have
// their own specs); every operator step goes through the console UI.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { backend, python, root, screenshot } from '../../support.mjs';

const SNAPSHOT = { currency: 'THB', as_of: new Date().toISOString().slice(0, 10), opening_balance: '80000.00', reserve: '15000.00', events: [] };

test('real Django operations console: payee verification, separation of duties, second-person approval, adapter results.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `ops-uat-${randomUUID()}`, operator: `operator-${randomUUID()}`, approver: `approver-${randomUUID()}` };
  const passwords = { student: randomUUID(), operator: randomUUID(), approver: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; from finance.corridors import ensure_default_corridors; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_corridors(); ensure_default_limits()'],
    { cwd: backend, env: { ...process.env, UAT_NAMES: JSON.stringify(names), UAT_PASSWORDS: JSON.stringify(passwords) }, stdio: 'pipe' });
  // A second student whose tuition payment will be waiting for the adapter result.
  const file = `${root}output/payment-ready-${randomUUID()}.json`;
  execFileSync(python, ['manage.py', 'demo_payment_ready', '--output', file], { cwd: backend, stdio: 'pipe', timeout: 240_000 });
  const ready = JSON.parse(readFileSync(file, 'utf-8'));
  rmSync(file);
  names.payer = ready.student.username; passwords.payer = ready.student.password;

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
  async function call(kind, path, body, headers = {}) {
    const identity = await (await contexts[kind].request.get(`${origin}/api/auth/session/`)).json();
    const response = body === undefined ? await contexts[kind].request.get(`${origin}/api/v2/${path}`)
      : await contexts[kind].request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID(), ...headers } });
    const payload = await response.json();
    return { status: response.status(), data: payload.data ?? payload };
  }
  async function ok(kind, path, body, headers) {
    const result = await call(kind, path, body, headers);
    assert.ok([200, 201].includes(result.status), `${path}: ${JSON.stringify(result.data)}`);
    return result.data;
  }
  async function stepUp(kind, action, target, amount, currency) {
    return (await ok(kind, 'auth/step-up/', { password: passwords[kind], action, target_id: target, amount, currency })).token;
  }

  try {
    const ops = await login('operator', '/?ops=1');
    await login('student', '/?wallet=1');
    await login('payer', '/?payments=1');
    await ops.getByRole('heading', { name: 'Operations console' }).waitFor();
    await ops.getByText(`Signed in as operator ${names.operator}.`).waitFor();

    // A student sees the staff-only message, not the queue.
    const denied = await call('student', 'operations/queue/');
    assert.equal(denied.status, 403);

    // Student: wallet with CNY savings and a new payee (operator receives the funds over the API).
    await ok('student', 'state/', { expected_version: 0, snapshot: SNAPSHOT });
    await ok('student', 'demo/initialize/', { state_version: 1 });
    const source = await ok('student', 'funding-sources/', { economic_key: `family-${randomUUID()}`, kind: 'external_savings', currency: 'CNY', amount: '40000.00', available_on: SNAPSHOT.as_of, certainty: 'confirmed' });
    await ok('operator', `funding-sources/${source.id}/receive/`, { hold_in_source_currency: true });
    const payeeName = `Family account ${randomUUID().slice(0, 6)}`;
    const payee = await ok('student', 'beneficiaries/', { name: payeeName, destination_label: 'MOCK-ONLY' });

    // Operator UI: verify the payee.
    await ops.getByRole('button', { name: 'Refresh' }).click();
    await ops.getByLabel('Student', { exact: true }).fill(names.student);
    const payeeRow = ops.getByRole('listitem', { name: `${names.student} · ${payeeName}` });
    await payeeRow.getByRole('button', { name: 'Verify payee' }).click();
    await payeeRow.getByText(/You will then not be allowed to approve/).waitFor();
    await payeeRow.getByRole('button', { name: 'Confirm' }).click();
    await ops.getByText(`${payeeName} is verified (simulated check).`).waitFor();
    await payeeRow.waitFor({ state: 'detached' });

    // Student: an over-limit CNY transfer to that payee needs an approval (T3).
    const corridor = (await ok('student', 'corridors/')).find(row => row.source_currency === 'CNY' && row.target_currency === 'THB');
    const quote = await ok('student', 'fx-quotes/live/', { corridor_id: corridor.id, send_amount: '15000.00' });
    const order = await ok('student', 'remittance-orders/', { quote_id: quote.id, recipient: 'BENEFICIARY', beneficiary_id: payee.id, purpose: 'family_support' });
    const refused = await call('student', `remittance-orders/${order.id}/submit/`, { expected_version: order.version });
    assert.equal(refused.data.detail, 'APPROVAL_REQUIRED');
    const reason = `UAT family transfer ${randomUUID().slice(0, 6)}`;
    await ok('student', 'approvals/', { action: 'remittance.submit', target_id: order.id, amount: '15000.00', currency: 'CNY', reason });

    // Operator UI: the verifier of this payee is blocked from deciding.
    await ops.getByRole('button', { name: 'Refresh' }).click();
    const blocked = ops.getByRole('article').filter({ hasText: reason });
    await blocked.getByText('You verified this payee, so another operator must decide.').waitFor();
    await blocked.getByText('You', { exact: true }).waitFor();
    assert.equal(await blocked.getByRole('button', { name: 'Approve' }).count(), 0);

    // Approver UI: second person approves with a note.
    const approver = await login('approver', '/?ops=1');
    await approver.getByLabel('Student', { exact: true }).fill(names.student);
    const card = approver.getByRole('article').filter({ hasText: reason });
    await card.getByText(/CNY 15,000\.00 → THB/).waitFor();
    await card.getByLabel('Decision note (shown to the student)').fill('Payee and purpose checked');
    await card.getByRole('button', { name: 'Approve' }).click();
    await card.getByRole('button', { name: 'Confirm' }).click();
    await approver.getByText(`Approved. ${names.student} can now submit with their password.`).waitFor();
    const decided = approver.locator('#ops-decisions tbody tr').filter({ hasText: 'Payee and purpose checked' });
    await decided.getByText('Approved').waitFor();
    await decided.getByText(names.approver).waitFor();

    // Student submits with the password; the transfer is now in flight.
    const token = await stepUp('student', 'remittance.submit', order.id, '15000.00', 'CNY');
    const submitted = await ok('student', `remittance-orders/${order.id}/submit/`, { expected_version: order.version }, { 'X-Step-Up-Token': token });
    assert.equal(submitted.status, 'SUBMITTED');

    // Payer: submit the ready tuition payment (T2) so it waits for the adapter.
    const state = await ok('payer', 'readiness/state/');
    const plans = await ok('payer', 'readiness/funding-plans/');
    const payment = await ok('payer', 'payments/', { readiness_plan_id: plans[0].id, event_id: ready.event_id, beneficiary_id: ready.beneficiary_id });
    await ok('payer', `payments/${payment.id}/authorize/`, { state_version: state.state_version });
    const grant = await stepUp('payer', 'payment.submit', payment.id, payment.amount, 'THB');
    await ok('payer', `payments/${payment.id}/submit/`, {}, { 'X-Step-Up-Token': grant });

    // Operator UI: adapter results for the transfer and the payment.
    await ops.getByRole('button', { name: 'Refresh' }).click();
    const transfer = ops.getByRole('listitem', { name: `${names.student} · CNY → THB` });
    await transfer.getByRole('button', { name: 'Dispatched' }).click();
    await transfer.getByRole('button', { name: 'Confirm' }).click();
    await ops.getByText('Recorded the simulated adapter result: Dispatched.').waitFor();
    await transfer.getByText('In transit', { exact: false }).first().waitFor();
    await transfer.getByRole('button', { name: 'Delivered' }).click();
    await transfer.getByRole('button', { name: 'Confirm' }).click();
    await ops.getByText('Recorded the simulated adapter result: Delivered.').waitFor();
    await transfer.waitFor({ state: 'detached' });
    await ops.getByLabel('Student', { exact: true }).fill(names.payer);
    const tuition = ops.getByRole('listitem', { name: `${names.payer} · ${ready.event_id}` });
    await tuition.getByRole('button', { name: 'Settled' }).click();
    await tuition.getByText(/Settled debits the student's wallet/).waitFor();
    await ops.screenshot({ path: screenshot('operations-confirm.png'), fullPage: true });
    await tuition.getByRole('button', { name: 'Confirm' }).click();
    await ops.getByText('Recorded the simulated adapter result: Settled.').waitFor();
    await tuition.waitFor({ state: 'detached' });

    // Django state agrees, and the audit log names who did what.
    assert.equal((await ok('student', `remittance-orders/${order.id}/`)).status, 'DELIVERED');
    assert.equal((await ok('payer', `payments/${payment.id}/`)).status, 'settled');
    const audit = (await ok('student', 'audit/')).results;
    const approval = audit.find(row => row.action === 'approval.approved');
    assert.ok(approval, 'approval.approved missing from the student audit log');
    await ops.screenshot({ path: screenshot('operations-after.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
