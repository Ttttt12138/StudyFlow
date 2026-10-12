// Real Django/PostgreSQL: a student issues a signed statement in the trust center; a separate, cookie-less
// browser context (a landlord) verifies it on the public page, then a tampered copy fails.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

test('real Django credit statement: snapshot, issue, anonymous verify, tamper detection.', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const username = `credit-uat-${randomUUID()}`, password = randomUUID();
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.contrib.auth import get_user_model; get_user_model().objects.create_user(username=os.environ["UAT_NAME"], password=os.environ["UAT_PASSWORD"])'],
    { cwd: backend, env: { ...process.env, UAT_NAME: username, UAT_PASSWORD: password }, stdio: 'pipe' });
  const errors = [];
  const student = await browser.newContext({ locale: 'en-US', viewport: { width: 1360, height: 900 } });
  const landlord = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  try {
    const page = await student.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + '/?trust=1')}`);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    const section = page.locator('#trust-statements');
    await section.getByText('No snapshots yet. Take one to issue a statement.').waitFor();
    await section.getByRole('button', { name: 'Take a snapshot now' }).click();
    await section.getByText(/Snapshot taken \(level Building\)\./).waitFor();
    await section.getByRole('button', { name: /Issue signed statement for the snapshot/ }).click();
    await section.getByText('Signed statement issued. It expires in 90 days.').waitFor();
    const statement = await section.getByRole('textbox', { name: 'Signed statement' }).inputValue();
    assert.ok(statement.length > 40 && statement.length <= 4000);
    await page.screenshot({ path: screenshot('credit-integration-issued.png'), fullPage: true });

    const check = await landlord.newPage();
    check.on('pageerror', error => errors.push(error.message));
    await check.goto(`${origin}/?verify=1`);
    await check.locator('#verify-statement').fill(statement);
    await check.getByRole('button', { name: 'Verify statement' }).click();
    await check.getByRole('heading', { name: 'Valid statement' }).waitFor();
    await check.locator('.credit-result.valid').getByText(username).waitFor();
    await check.locator('.credit-result.valid dd', { hasText: 'Building' }).waitFor();
    await check.screenshot({ path: screenshot('credit-integration-verified-mobile.png'), fullPage: true });
    assert.equal((await landlord.cookies()).some(cookie => cookie.name === 'sessionid'), false);

    const tampered = statement.slice(0, -2) + (statement.endsWith('AA') ? 'BB' : 'AA');
    await check.locator('#verify-statement').fill(tampered);
    await check.getByRole('button', { name: 'Verify statement' }).click();
    await check.getByRole('heading', { name: 'Not a valid statement' }).waitFor();
    await check.getByText(/The signature does not match/).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await student.close(); await landlord.close();
  }
});
