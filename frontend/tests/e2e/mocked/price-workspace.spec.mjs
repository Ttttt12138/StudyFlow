import { test, expect } from '@playwright/test';
const tools = page => page.getByRole('navigation', { name: 'Tools' });
test.beforeEach(async ({ page }) => { await page.route('**/api/**', route => route.abort()); });

test('to-dos and wallet open together after application submission', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview');
  await expect(tools(page).getByRole('button', { name: 'My plan', exact: true })).toBeVisible();
  await expect(tools(page).getByRole('button', { name: 'Wallet & payments', exact: true })).toHaveCount(0);
  await page.goto('/?plan=preview&stage=prepare');
  for (const name of ['To-dos and bills', 'Wallet & payments']) await expect(tools(page).getByRole('button', { name, exact: true })).toBeVisible();
  for (const name of ['Family support', 'Credit record', 'Record expense']) await expect(tools(page).getByRole('button', { name, exact: true })).toHaveCount(0);
});
test('money deep links require an application and price tools remain available', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview&tool=wallet&stage=plan');
  await expect(page.locator('.workspace-dock')).toBeHidden();
  await expect(page).not.toHaveURL(/tool=wallet/);
  await tools(page).getByRole('button', { name: 'School comparison', exact: true }).click();
  await expect(page.locator('.price-history')).toBeVisible();
});
test('a price result opened from the comparison list goes back to the list; one opened from the chat only closes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview&tool=compare');
  const header = page.locator('.workspace-dock-header');
  await page.locator('.price-history li button').first().click();
  await expect(page).toHaveURL(/tool=card.*from=compare/);
  await header.getByRole('button', { name: 'Back to School comparison' }).click();
  await expect(page.locator('#workspace-tool-title')).toHaveText('School comparison');
  await expect(header.getByRole('button', { name: /^Back/ })).toHaveCount(0);
  await page.locator('#plan-chat').getByRole('button', { name: /^Line items/ }).first().click();
  await expect(page).toHaveURL(/tool=card/);
  await expect(page).not.toHaveURL(/from=compare/);
  await expect(header.getByRole('button', { name: /^Back/ })).toHaveCount(0);
});
test('currency display changes without writes and loan preview retains exact quote', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview');
  await page.getByRole('group', { name: 'Show prices in' }).getByRole('button', { name: '¥ CNY' }).click();
  await expect(page.getByRole('article', { name: 'Chulalongkorn University · 4-year total' })).toContainText('≈ ¥511,163');
  await tools(page).getByRole('button', { name: 'My plan', exact: true }).click();
  const costs = page.locator('.plan-visual');
  await expect(costs).toContainText('¥511,163');
  await expect(costs).toContainText('฿2,351,350');
  await expect(costs.locator('.chart-legend')).toContainText('¥223,663');
  await expect(costs.locator('.chart-legend')).toContainText('43.8%');
  await expect(page.locator('.assessment-quotes article')).toHaveCount(1);
  await expect(page.locator('.assessment-quotes')).toContainText('200,000.00');
});
test('at 390px the tool drawer and loan details fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?plan=preview&tool=funding');
  await expect(page.locator('.workspace-dock')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
