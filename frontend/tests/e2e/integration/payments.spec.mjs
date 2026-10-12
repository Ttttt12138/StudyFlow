// Real Django/PostgreSQL: a synthetic student pays a verified tuition invoice from the payments page.
// Setup stops just before the payment (manage.py demo_payment_ready); every payment step after that
// goes through the UI, except the operator's simulated adapter result, which has no UI yet.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { backend, python, root, screenshot } from '../../support.mjs';

test('real Django payment: create, authorize, password step-up, sandbox settlement, invoice reconciliation, receipt and audit.', async ({ browser, playwright }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const file = `${root}output/payment-ready-${randomUUID()}.json`;
  execFileSync(python, ['manage.py', 'demo_payment_ready', '--output', file], { cwd: backend, stdio: 'pipe', timeout: 240_000 });
  const ready = JSON.parse(readFileSync(file, 'utf-8'));
  rmSync(file);
  const errors = [], endpoints = new Set();
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  const operator = await playwright.request.newContext({ baseURL: `${origin}/api/v2/`, extraHTTPHeaders: { Authorization: `Token ${ready.operator.token}` } });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/v2/')) endpoints.add(`${request.method()} ${path.replace(/[0-9a-f-]{36}/g, '{id}')}`); });
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(`${origin}/?payments=1`)}`);
    await page.getByLabel('Username').fill(ready.student.username);
    await page.getByLabel('Password').fill(ready.student.password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.getByRole('heading', { name: 'Payments', exact: true }).waitFor();
    const detail = page.locator('#pay-detail');

    // Bill → draft payment (T1).
    await page.getByText(/Funding plan checked .* and still current/).waitFor();
    const bill = page.getByRole('row').filter({ has: page.getByRole('radio') }).filter({ hasText: 'Ready to pay' });
    await bill.getByText('Invoice DEMO-2026-1').waitFor();
    await bill.getByRole('radio').check();
    await page.getByRole('button', { name: 'Create payment' }).click();
    await page.getByText('Payment created as a draft.').waitFor();
    await detail.getByText('Draft', { exact: true }).waitFor();

    // Authorize against the current state version (T1).
    await detail.getByLabel('I checked the payee, the amount and the invoice.').check();
    await detail.getByRole('button', { name: 'Authorize' }).click();
    await page.getByText('Payment authorized for 15 minutes.').waitFor();

    // Submit is T2: Django asks for the password; a wrong one is refused and audited.
    await detail.getByRole('button', { name: 'Submit payment' }).click();
    await page.getByRole('alert').filter({ hasText: 'Submitting a payment needs your password again.' }).waitFor();
    await page.getByLabel('Password').fill(`wrong-${randomUUID()}`);
    await page.getByRole('dialog', { name: 'Review and confirm' }).getByRole('button', { name: 'Confirm and submit' }).click();
    await page.getByRole('alert').filter({ hasNotText: 'needs your password' }).waitFor();
    await detail.getByText('Authorized', { exact: true }).waitFor();
    await page.getByLabel('Password').fill(ready.student.password);
    await page.getByRole('dialog', { name: 'Review and confirm' }).getByRole('button', { name: 'Confirm and submit' }).click();
    await page.getByText('Payment submitted. Status: Submitted.').waitFor();
    await detail.getByText(/Waiting for the simulated adapter result/).waitFor();

    // The operator records the sandbox adapter result over the API (no operator UI yet).
    const payment = (await (await context.request.get(`${origin}/api/v2/payments/`)).json()).results[0];
    const settled = await operator.post(`payments/${payment.id}/adapter-event/`, { data: { outcome: 'settled' }, headers: { 'Idempotency-Key': randomUUID() } });
    assert.equal(settled.status(), 201, await settled.text());

    // Settled → reconcile against the invoice in the UI; the receipt and ledger entry are shown.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await detail.getByText('Settled', { exact: true }).waitFor();
    await detail.getByRole('heading', { name: 'Settlement receipt' }).waitFor();
    await detail.getByRole('button', { name: 'Reconcile with invoice' }).click();
    await page.getByText('Receipt matches the invoice. The payment is reconciled.').waitFor();
    await detail.getByText('Reconciled', { exact: true }).first().waitFor();
    await detail.getByText('Matched', { exact: true }).waitFor();
    await detail.getByText(/^#\d+ · THB -?30,000\.00$|^#\d+ · -THB 30,000\.00$/).waitFor();
    for (const name of ['Payment created', 'Payment authorized', 'Password re-check failed', 'Password re-check passed',
      'Submitted to sandbox adapter', 'Settled (sandbox)', 'Reconciled with invoice'])
      await detail.locator('.pay-audit').getByText(name, { exact: true }).waitFor();
    await page.screenshot({ path: screenshot('payments-reconciled.png'), fullPage: true });

    // The server is the source of truth: a reload shows the same reconciled payment.
    await page.reload();
    await detail.getByText('Paid and reconciled.').waitFor();
    const stored = (await (await context.request.get(`${origin}/api/v2/payments/${payment.id}/`)).json()).data;
    assert.equal(stored.status, 'reconciled');
    assert.equal(stored.receipt.invoice_id, 'DEMO-2026-1');
    for (const call of ['POST /api/v2/payments/', 'POST /api/v2/payments/{id}/authorize/', 'POST /api/v2/auth/step-up/',
      'POST /api/v2/payments/{id}/submit/', 'POST /api/v2/payments/{id}/reconcile/'])
      assert.ok(endpoints.has(call), `${call} was not called from the page`);
    assert.deepEqual(errors, []);
  } finally {
    await operator.dispose();
    await context.close();
  }
});
