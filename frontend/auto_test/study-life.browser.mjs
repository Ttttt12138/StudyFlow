import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const origin = process.env.LIFE_TEST_URL;
if (!origin || !process.env.LIFE_TEST_PASSWORD) throw new Error('Use the isolated Django browser test.');
const output = new URL('../../evidence/study-life-20261013/', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const evidence = { backend: 'Real Django/PostgreSQL, isolated test database', planner: 'Rule provider', journeys: [] };

async function get(context, path) {
  const response = await context.request.get(`${origin}/api/v2/${path}`);
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).data;
}
async function say(page, text) {
  const response = page.waitForResponse(r => r.url().endsWith('/messages/') && r.request().method() === 'POST');
  await page.locator('#plan-chat textarea').fill(text);
  await page.locator('#plan-chat textarea').press('Enter');
  const result = await response;
  assert.ok(result.ok(), await result.text());
  assert.equal((await result.json()).data.status, 'COMPLETED');
}
async function save(form) { await form.getByRole('button', { name: /^(Save|保存)$/ }).click(); }

try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'life-mobile' : 'life-desktop';
    const context = await browser.newContext({ locale: mobile ? 'zh-CN' : 'en-US', viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + '/')}`);
    await page.locator('input[name=username]').fill(name);
    await page.locator('input[name=password]').fill(process.env.LIFE_TEST_PASSWORD);
    await page.getByRole('button', { name: /Log in|登录/ }).click();
    await page.waitForURL(origin + '/');
    await expect(page.locator('.life-bell-button')).toBeVisible();
    // "This month": each to-do is one row that opens its own page; the page has the actions and a back button.
    const panel = page.locator('.life-panel');
    const back = () => panel.getByRole('button', { name: /^(Back|返回)$/ }).click();
    await say(page, mobile ? '提醒我明天交住宿材料' : 'Remind me tomorrow to submit housing documents');
    // The confirmed plan also has checklist tasks, so the chat task is found by its title.
    const row = panel.locator('.life-list [data-source^="task:"]').filter({ hasText: /submit housing documents|住宿材料/ });
    await expect(row).toContainText('2027-08-02');
    const key = await row.getAttribute('data-source');
    const item = panel.locator(`[data-source="${key}"]`);
    await row.locator('.life-item-main').click();
    await item.getByRole('button', { name: /^(Got it|知道了)$/ }).click();
    await expect(item.getByRole('button', { name: /^(Got it|知道了)$/ })).toHaveCount(0);
    await page.reload();
    await expect(row).toBeVisible();
    assert.equal((await get(context, 'planning/life/')).items.find(i => i.source_key === key).unread, false);
    await row.locator('.life-item-main').click();
    await item.getByRole('button', { name: /^(Remind later|稍后提醒)$/ }).click();
    await item.locator('input[type=date]').fill('2027-08-03');
    await save(item.locator('form'));
    assert.equal((await get(context, 'planning/life/')).items.find(i => i.source_key === key).snoozed, true);
    await back();
    // The demo date is a link in the panel header that opens its own page.
    await panel.locator('.life-date').click();
    await panel.locator('input[type=date]').fill('2027-08-03');
    await panel.getByRole('button', { name: /Advance demo date|推进模拟日期/ }).click();
    await expect(row).toContainText(mobile ? '已逾期' : 'Overdue');
    assert.equal((await get(context, 'planning/profile/')).plan.status, 'CONFIRMED');
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-reminders.png`, output)), animations: 'disabled' });
    await row.locator('.life-item-main').click();
    await item.getByRole('button', { name: /^(Mark completed|标记完成)$/ }).click();
    assert.equal((await get(context, 'planning/life/')).items.find(i => i.source_key === key).done, true);
    await back();
    await expect(panel.locator(`.life-list [data-source="${key}"]`)).toHaveCount(0);
    await panel.locator('.life-list [data-source^="enrollment:"] .life-item-main').click();
    await panel.locator('[data-source^="enrollment:"]').getByRole('button', { name: /Review enrollment|核对报到/ }).click();
    const confirm = page.locator('#plan-chat').getByRole('button', { name: /^(Confirm|确认)$/ }).last();
    await confirm.click();
    await page.getByRole('dialog').getByRole('button', { name: /^(Confirm|确认)$/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.life-bell-button').click();
    await page.locator('.life-bell-panel').getByRole('button', { name: /Open This month|打开本月/ }).click();
    // The budget is edited in place in the summary card; spending is recorded on its own page.
    const summary = panel.locator('.life-summary');
    await summary.getByRole('button', { name: /Edit budget|修改预算/ }).click();
    await summary.locator('form input').fill('6000');
    await save(summary.locator('form'));
    await expect(summary).toContainText('6,000');
    await panel.getByRole('button', { name: /^(Record spending|记一笔)$/ }).click();
    await panel.getByLabel(/^(Amount|金额)/).fill('120');
    await panel.getByLabel(/What was it|买了什么/).fill('Lunch');
    await save(panel.locator('form'));
    await expect(summary).toContainText('5,880');
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-budget.png`, output)), animations: 'disabled' });
    const spending = panel.locator('.life-spending');
    await spending.getByRole('button', { name: /Undo entry|撤销记录/ }).click();
    await expect(spending.getByRole('button', { name: /Undo entry|撤销记录/ })).toHaveCount(0);
    assert.equal((await get(context, 'planning/life/')).budget.remaining, '6000.00');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    evidence.journeys.push({ name, locale: mobile ? 'zh' : 'en', passed: ['chat task', 'acknowledge + reload', 'snooze + clock + overdue', 'completion', 'explicit enrollment', 'budget edit', 'expense + undo', 'no horizontal overflow'], pageErrors: errors });
    await page.goto(`${origin}/?plan=preview&stage=school&tool=life`);
    await expect(panel.locator('.life-summary-budget')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Add task|添加待办/ })).toBeDisabled();
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-preview.png`, output)), animations: 'disabled' });
    await context.close();
  }
  writeFileSync(new URL('browser.json', output), JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
