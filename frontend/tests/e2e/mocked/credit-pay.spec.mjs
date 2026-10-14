import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Pay later: a bill in "This month" can be paid from the credit line, and the wallet shows balance and credit as one loop.
const read = name => JSON.parse(readFileSync(new URL(`../../../src/plan/preview-data/${name}.json`, import.meta.url), 'utf8'));

async function signedIn(page) {
  const data = read('school.en');
  const life = read('life.school.en');
  const posts = [];
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST') posts.push({ path, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
    if (path.endsWith('/planning/credit/pay/')) return route.fulfill({ status: 201, json: { data: life } });
    if (path.endsWith('/planning/life/')) return route.fulfill({ json: { data: life } });
    if (path.endsWith('/planning/credit/')) return route.fulfill({ json: { data: life.credit } });
    const result = path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation : path.endsWith('/planning/in-school/') ? data.in_school : [];
    return route.fulfill({ json: { data: result } });
  });
  return { life, posts };
}

test('a bill within the available credit is paid with credit, with its token and an idempotency key', async ({ page }) => {
  const { life, posts } = await signedIn(page);
  const bill = life.items.find(item => item.kind === 'bill' && !item.done && item.currency === 'THB' && Number(item.amount) <= Number(life.credit.available));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?tool=life&section=${bill.source_key}`);
  const panel = page.locator('.life-panel');
  await expect(panel.getByText('Credit available THB 10,500.00', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Pay with credit', exact: true }).click();
  await expect.poll(() => posts.find(post => post.path.endsWith('/planning/credit/pay/'))).toBeTruthy();
  const post = posts.find(item => item.path.endsWith('/planning/credit/pay/'));
  expect(post.body).toEqual({ source_key: bill.source_key, expected_token: bill.token });
  expect(post.key).toBeTruthy();
});

test('a bill larger than the available credit cannot be paid with credit', async ({ page }) => {
  const { life } = await signedIn(page);
  const bill = life.items.find(item => item.kind === 'bill' && !item.done && item.currency === 'THB' && Number(item.amount) > Number(life.credit.available));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?tool=life&section=${bill.source_key}`);
  const panel = page.locator('.life-panel');
  await expect(panel.getByRole('button', { name: 'Pay with credit', exact: true })).toBeDisabled();
  await expect(panel.getByText('Not enough credit', { exact: false })).toBeVisible();
});

test('the wallet joins the balance and the credit line in one Möbius loop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/**', route => route.abort());
  await page.goto('/?plan=preview&stage=school&tool=wallet');
  const loop = page.locator('.credit-loop');
  await expect(loop.getByRole('img', { name: /joined in one loop/ })).toBeVisible();
  await expect(loop).toContainText('Credit available');
  await expect(loop).toContainText('Can pay');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
