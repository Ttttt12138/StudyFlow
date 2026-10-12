// Real Django/PostgreSQL: family support across three people. The student asks, the operator sends the
// confirmation link from the console, the family member confirms anonymously, the operator records receipt.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const SNAPSHOT = { currency: 'THB', as_of: TODAY, opening_balance: '80000.00', reserve: '15000.00', events: [] };

test('real Django family support: request, operator link, anonymous confirmation, receipt in the wallet.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `family-uat-${randomUUID()}`, operator: `operator-${randomUUID()}` };
  const passwords = { student: randomUUID(), operator: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]'],
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
  const thb = async () => (await ok('student', 'demo/wallets/balances/')).balances.find(row => row.currency === 'THB').balance;

  try {
    const family = await login('student', '/?family=1');
    await ok('student', 'state/', { expected_version: 0, snapshot: SNAPSHOT });
    await ok('student', 'demo/initialize/', { state_version: 1 });
    const before = await thb();

    // Student asks for support.
    const purpose = `UAT rent help ${randomUUID().slice(0, 6)}`;
    await family.reload();
    await family.getByRole('heading', { name: 'Family support' }).waitFor();
    await family.getByLabel('Amount', { exact: true }).fill('6500');
    await family.getByLabel('Currency').selectOption('THB');
    await family.getByLabel('Available on', { exact: true }).fill(TODAY);
    await family.getByLabel('Purpose', { exact: true }).fill(purpose);
    await family.getByRole('button', { name: 'Create request' }).click();
    await family.getByText(/Request created \(reference /).waitFor();
    await family.getByText('Waiting for an operator to send the confirmation link to your family member.').waitFor();

    // Operator console: create the confirmation link (shown once).
    const ops = await login('operator', '/?ops=1');
    await ops.getByLabel('Student', { exact: true }).fill(names.student);
    const request = ops.getByRole('listitem', { name: `${names.student} · ${purpose}` });
    await request.getByRole('button', { name: 'Create confirmation link' }).click();
    await request.getByRole('button', { name: 'Confirm' }).click();
    const link = await request.getByLabel('Confirmation link').inputValue();
    assert.match(link, new RegExp(`^${origin.replace(/[.]/g, '\\.')}/\\?sponsor=1#token=[0-9a-f]{64}$`));

    // Family member: no account, no cookies; the token leaves the address bar immediately.
    const anonymous = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
    contexts.sponsor = anonymous;
    const sponsor = await anonymous.newPage();
    sponsor.on('pageerror', error => errors.push(error.message));
    await sponsor.goto(link);
    await sponsor.getByText(purpose).waitFor();
    assert.equal(new URL(sponsor.url()).hash, '');
    await sponsor.getByRole('button', { name: 'Confirm support' }).click();
    await sponsor.getByLabel(/I confirm I plan to provide this support/).check();
    await sponsor.getByRole('button', { name: 'Send confirmation' }).click();
    await sponsor.getByText(/your confirmation was recorded/).waitFor();
    await sponsor.screenshot({ path: screenshot('family-sponsor-confirmed-mobile.png'), fullPage: true });

    // Operator records the money; the student's wallet is credited.
    await ops.getByRole('button', { name: 'Refresh' }).click();
    await request.getByText('Confirmed by family').waitFor();
    await request.getByRole('button', { name: 'Record money received' }).click();
    await request.getByRole('button', { name: 'Confirm' }).click();
    await ops.getByText('THB 6,500.00 recorded as received.').waitFor();
    assert.equal(Number(await thb()) - Number(before), 6500);

    await family.reload();
    await family.getByText('Received — an operator recorded the money.').waitFor();
    await family.screenshot({ path: screenshot('family-received.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
