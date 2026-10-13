// Real Django/PostgreSQL: converting held CNY into THB on the wallet page, with the password step-up (T2),
// then reading both ledger legs.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const SNAPSHOT = { currency: 'THB', as_of: TODAY, opening_balance: '80000.00', reserve: '15000.00', events: [] };

test('real Django conversion: quotes for every tier, password step-up, balances and ledger legs.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { student: `convert-uat-${randomUUID()}`, operator: `operator-${randomUUID()}` };
  const passwords = { student: randomUUID(), operator: randomUUID() };
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os,json; from django.contrib.auth import get_user_model; from finance.corridors import ensure_default_corridors; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_corridors(); ensure_default_limits()'],
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
  const balance = async currency => (await ok('student', 'demo/wallets/balances/')).balances.find(row => row.currency === currency)?.balance ?? '0.00';

  try {
    const wallet = await login('student', '/?wallet=1');
    await login('operator', '/');
    await ok('student', 'state/', { expected_version: 0, snapshot: SNAPSHOT });
    await ok('student', 'demo/initialize/', { state_version: 1 });
    const source = await ok('student', 'funding-sources/', { economic_key: `family-${randomUUID()}`, kind: 'external_savings', currency: 'CNY', amount: '10000.00', available_on: TODAY, certainty: 'confirmed' });
    await ok('operator', `funding-sources/${source.id}/receive/`, { hold_in_source_currency: true });
    const thbBefore = Number(await balance('THB'));

    await wallet.reload();
    // Currency exchange is its own tab in the wallet panel.
    await wallet.getByRole('tab', { name: 'Exchange' }).click();
    const section = wallet.locator('section').filter({ has: wallet.getByRole('heading', { name: 'Convert between currencies' }) });
    await section.getByLabel('Convert from').selectOption('CNY');
    await section.getByLabel('Convert to').selectOption('THB');
    await section.getByLabel('Amount to convert (CNY)').fill('2000');
    await section.getByRole('button', { name: 'Get conversion quotes' }).click();
    await wallet.getByText(/quote\(s\) returned/).waitFor();
    await section.getByRole('button', { name: 'Use this quote' }).first().click();
    await section.getByLabel(/I reviewed these exact amounts/).check();
    await section.getByRole('button', { name: 'Convert now' }).click();
    // wallet.convert is T2: the password panel opens, then the retry carries the single-use grant.
    await wallet.getByRole('dialog', { name: 'Review and confirm' }).getByLabel('Password', { exact: true }).fill(passwords.student);
    await wallet.getByRole('dialog', { name: 'Review and confirm' }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await wallet.getByText('Conversion recorded. Balances and the ledger were refreshed.').waitFor();
    await wallet.screenshot({ path: screenshot('wallet-conversion.png'), fullPage: true });

    assert.equal(await balance('CNY'), '8000.00');
    assert.ok(Number(await balance('THB')) > thbBefore, 'THB was not credited');
    const ledger = (await ok('student', 'ledger/')).results.filter(row => row.conversion);
    assert.deepEqual(ledger.map(row => row.currency).sort(), ['CNY', 'THB']);
    assert.ok((await ok('student', 'audit/')).results.some(row => row.action === 'auth.step_up_granted'));
    assert.deepEqual(errors, []);
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
