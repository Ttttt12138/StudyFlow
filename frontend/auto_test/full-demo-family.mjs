import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openOpsItem } from '../tests/operations-support.mjs';

export async function recordedRole(h, role, url, username) {
  const dir = fileURLToPath(new URL(`raw-${role}/`, h.output));
  mkdirSync(dir, { recursive: true });
  const context = await h.browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 },
    recordVideo: { dir, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => h.extraErrors.push(`${role}: ${error.message}`));
  const started = performance.now(), marks = [];
  if (username) {
    await page.goto(`${h.origin}/api/auth/login/?next=${encodeURIComponent(h.origin + url)}`);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(process.env.SHORT_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
  } else await page.goto(url);
  return { context, page, async mark(name, hold = 6) {
    marks.push({ name, seconds: (performance.now() - started) / 1000 });
    writeFileSync(new URL(`${role}-marks.json`, h.output), JSON.stringify(marks, null, 2));
    await page.waitForTimeout(hold * 1000);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, h.output)) });
  }, async close() {
    await context.close();
    writeFileSync(new URL(`${role}-source.json`, h.output), JSON.stringify({ path: await page.video().path() }));
  } };
}

export async function familyJourney(h) {
  const { page } = h;
  const balance = async () => (await h.read('demo/wallets/balances/')).balances.find(b => b.currency === 'THB').balance;
  const before = Number(await balance());
  const clock = (await h.read('demo/wallets/')).results[0].clock;
  await h.open('family');
  await page.getByRole('tab', { name: 'Ask family' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('6500');
  await page.locator('#family-create-form select').selectOption('THB');
  await page.getByLabel('Available on', { exact: true }).fill(clock);
  await page.getByLabel('Purpose', { exact: true }).fill('First-month housing support');
  await h.mark('family-request');
  await page.getByRole('button', { name: 'Create request' }).click();
  await page.getByText(/Request created \(reference /).waitFor();
  const ops = await recordedRole(h, 'operator', '/?ops=1', 'full-operator');
  let sponsor;
  try {
    await ops.page.getByRole('navigation').getByRole('button', { name: /^Work queue/ }).click();
    await ops.page.getByLabel('Student', { exact: true }).fill('short-desktop');
    let request = await openOpsItem(ops.page, 'sponsor', 'First-month housing support');
    await request.getByRole('button', { name: 'Create confirmation link' }).click();
    await request.getByRole('button', { name: 'Confirm', exact: true }).click();
    const link = await request.getByLabel('Confirmation link').inputValue();
    sponsor = await recordedRole(h, 'family', link);
    await sponsor.page.getByRole('button', { name: 'Confirm support' }).click();
    await sponsor.page.getByLabel(/I confirm I plan to provide this support/).check();
    await sponsor.mark('family-confirms');
    await sponsor.page.getByRole('button', { name: 'Send confirmation' }).click();
    await sponsor.page.getByText(/your confirmation was recorded/).waitFor();
    assert.equal(Number(await balance()), before, 'A promise is not wallet cash');
    await sponsor.mark('family-promise-recorded', 4);
    await request.getByRole('button', { name: 'Close details' }).click();
    await ops.page.getByRole('button', { name: 'Refresh', exact: true }).click();
    request = await openOpsItem(ops.page, 'sponsor', 'First-month housing support');
    await request.getByText('Confirmed by family', { exact: true }).waitFor();
    await request.getByRole('button', { name: 'Record money received' }).click();
    await request.getByRole('button', { name: 'Confirm', exact: true }).click();
    await ops.page.getByText('THB 6,500.00 recorded as received.').waitFor();
    await ops.mark('family-receipt');
    assert.equal(Number(await balance()) - before, 6500);
    await page.reload();
    await page.getByRole('tab', { name: 'Supported' }).click();
    await page.getByText('Received — an operator recorded the money.').waitFor();
    await h.mark('family-received');
    h.check('Family request, anonymous promise, operator receipt', { received: '6500.00', promiseMovedMoney: false });
  } finally { await sponsor?.close(); await ops.close(); }
}
