import { test, expect } from '@playwright/test';
import { screenshot } from '../../support.mjs';

// Guards the price-first workspace that replaced the journey rail, the status rail and the three-stage intro:
// price tools before enrollment, life tools after it, the enrollment gate, the currency switch,
// the funding panel's steps and the phone drawer. Everything runs on the recorded preview, without Django.
const tools = page => page.getByRole('navigation', { name: 'Tools' });
// "Funding & loan" may carry a "Funding gap" dot in its name, so items match on the start of their name.
const item = (page, name) => tools(page).getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
const PRICE_TOOLS = ['School comparison', 'My plan', 'My loans'];
const TODO = 'This month', WALLET = 'Wallet & payments';
// The credit record is not a daily tool: it is in the settings menu once enrolled.
const EXTRAS = ['Credit record'];

let apiCalls;
test.beforeEach(async ({ page }) => {
  apiCalls = [];
  await page.route('**/api/**', route => { apiCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return route.abort(); });
});

test('the sidebar adds This month once the plan is confirmed and the wallet once enrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview');
  await expect(page.locator('#plan-chat .plan-turn').first()).toBeVisible();
  await expect(page.locator('.workspace-stage')).toHaveText('Comparing prices');
  await expect(tools(page).getByRole('button', { name: 'New price question' })).toBeVisible();
  for (const name of PRICE_TOOLS) await expect(item(page, name)).toBeVisible();
  for (const name of [TODO, WALLET, ...EXTRAS]) await expect(tools(page).getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(tools(page).getByText('This month appears here once the plan is confirmed.')).toBeVisible();

  await page.goto('/?plan=preview&stage=prepare');
  await expect(page.locator('.workspace-stage')).toHaveText('Preparing to leave');
  await expect(tools(page).getByText('Arrival & daily life', { exact: true })).toBeVisible();
  await expect(item(page, TODO)).toBeVisible();
  await expect(item(page, WALLET)).toHaveCount(0);
  await expect(tools(page).getByText('After enrollment, This month adds spending and Wallet & payments appears.')).toBeVisible();
  // The confirmed plan already lists the country checklist and the first bills; spending waits for enrollment.
  await item(page, TODO).click();
  await expect(page.locator('#workspace-tool-title')).toHaveText(TODO);
  await expect(page.locator('.life-spending')).toHaveCount(0);
  // A row opens its own page with a back button; a checklist item shows its note there.
  await page.locator('.life-panel .life-item-main').filter({ hasText: 'Register at the university' }).click();
  await expect(page.locator('.life-panel').getByText('General checklist item', { exact: false })).toBeVisible();
  await page.locator('.life-panel').getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.life-panel .life-todo')).toBeVisible();
  await expect(page.locator('.life-panel details')).toHaveCount(0);

  await page.goto('/?plan=preview&stage=school');
  await expect(page.locator('.workspace-stage')).toHaveText('Enrolled');
  for (const name of [...PRICE_TOOLS, TODO, WALLET]) await expect(item(page, name)).toBeVisible();
  for (const name of EXTRAS) await expect(item(page, name)).toHaveCount(0);
  // While a tool is open the sidebar is icon-only but every item keeps its accessible name.
  await item(page, TODO).click();
  await expect(page.locator('#workspace-tool-title')).toHaveText(TODO);
  await expect(page.locator('.life-spending')).toBeVisible();
  await expect(page.locator('.tool-sidebar')).toHaveClass(/is-compact/);
  await item(page, WALLET).click();
  await expect(page.locator('#workspace-tool-title')).toHaveText(WALLET);
  for (const name of EXTRAS) {
    await tools(page).getByRole('button', { name: 'Settings' }).click();
    await page.locator('#side-settings').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#workspace-tool-title')).toHaveText(name);
  }
  expect(apiCalls).toEqual([]);
});

test('a money tool asked for before enrollment is refused with a notice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview&tool=wallet&stage=plan');
  await expect(page.getByRole('status').filter({ hasText: 'That tool opens once enrollment is confirmed. For now: prices, comparisons and funding.' })).toBeVisible();
  await expect(page.locator('.workspace-dock')).toBeHidden();
  await expect(page).not.toHaveURL(/tool=wallet/);
  // Price tools still open, and opening one clears the notice.
  await tools(page).getByRole('button', { name: 'School comparison', exact: true }).click();
  await expect(page.locator('#workspace-tool-title')).toHaveText('School comparison');
  await expect(page.locator('.workspace-notice')).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

test('the currency switch shows the preview price card in CNY without writing anything', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview');
  const card = page.locator('#plan-chat').getByRole('article', { name: 'Chulalongkorn University · 4-year total' });
  await expect(card).toContainText('฿2,351,350');
  const currency = page.getByRole('group', { name: 'Show prices in' });
  await expect(currency.getByRole('button', { name: '฿ THB' })).toHaveAttribute('aria-pressed', 'true');
  await currency.getByRole('button', { name: '¥ CNY' }).click();
  await expect(currency.getByRole('button', { name: '¥ CNY' })).toHaveAttribute('aria-pressed', 'true');
  // The total is converted at the sample rate (4.60 THB per CNY); the catalog figure stays as the secondary amount.
  await expect(card.locator('p').first()).toContainText('≈ ¥511,163');
  await expect(card).toContainText('¥223,663');
  await currency.getByRole('button', { name: '฿ THB' }).click();
  await expect(card).toContainText('฿2,351,350');
  expect(apiCalls).toEqual([]);
});

test('the short-plan preview offers the commercial example alongside two terms without writes', async ({ page }) => {
  await page.goto('/?plan=preview&tool=funding');
  await expect(page.locator('#workspace-tool-title')).toHaveText('My plan');
  const dock = page.locator('.workspace-dock');
  await expect(dock).toContainText('Read-only preview');
  await expect(dock.locator('.plan-visual-quote')).toHaveCount(3);
  await expect(dock).toContainText('48 months');
  await expect(dock).toContainText('24 months');
  const example = dock.getByRole('radio', { name: 'Commercial study loan (example)', exact: true });
  await expect(example).toHaveCount(1);
  await example.check();
  await expect(example).toBeChecked();
  // The family summary is on the "Details and sources" page.
  const summary = async (text, open = /^Details and sources/, back = 'Back') => {
    await dock.getByRole('button', { name: open }).click();
    await expect(dock.locator('.assessment-summary')).toContainText(text);
    await dock.getByRole('button', { name: back }).click();
  };
  await summary('Commercial study loan (example)');
  await dock.getByRole('radio', { name: '24 months', exact: true }).check();
  await expect(example).not.toBeChecked();
  await summary('Custom simulated loan');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await dock.getByRole('radio', { name: '商业助学贷款（示例）', exact: true }).check();
  await summary('商业助学贷款（示例）', /^明细与来源/, '返回');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(dock.getByRole('button', { name: 'Review application' })).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

test('at 390px the tools open from a drawer and nothing overflows sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/?plan=preview', '/?plan=preview&stage=school']) {
    await page.goto(url);
    await expect(page.locator('#plan-chat .plan-turn').first()).toBeVisible();
    await expect(tools(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const menu = page.getByRole('button', { name: 'Tools', exact: true });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(tools(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: screenshot(`price-workspace-drawer-390${url.includes('school') ? '-school' : ''}.png`) });
    await tools(page).getByRole('button', { name: 'School comparison', exact: true }).click();
    await expect(tools(page)).toHaveCount(0);
    await expect(page.locator('#workspace-tool-title')).toHaveText('School comparison');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Close tool' }).click();
    // The drawer's own close button and Escape both dismiss it.
    await menu.click();
    await tools(page).getByRole('button', { name: 'Close menu' }).click();
    await expect(tools(page)).toHaveCount(0);
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(tools(page)).toHaveCount(0);
  }
  expect(apiCalls).toEqual([]);
});
