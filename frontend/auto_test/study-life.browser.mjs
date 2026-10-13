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
    await expect(page.locator('.life-overview')).toBeVisible();
    await say(page, mobile ? '提醒我明天交住宿材料' : 'Remind me tomorrow to submit housing documents');
    const panel = page.locator('.life-panel');
    const task = panel.locator('[data-source^="task:"]').first();
    await expect(task).toContainText('2027-08-02');
    const key = await task.getAttribute('data-source');
    await task.getByRole('button', { name: /^(Got it|知道了)$/ }).click();
    await expect(task.getByRole('button', { name: /^(Got it|知道了)$/ })).toHaveCount(0);
    await page.reload();
    await expect(task).toBeVisible();
    assert.equal((await get(context, 'planning/life/')).items.find(i => i.source_key === key).unread, false);
    await task.getByRole('button', { name: /^(Remind later|稍后提醒)$/ }).click();
    await task.locator('input[type=date]').fill('2027-08-03');
    await save(task.locator('form'));
    await expect(panel.locator('section').filter({ has: page.getByRole('heading', { name: /^(Upcoming reminders|近期提醒)$/ }) }).locator('[data-source^="task:"]')).toHaveCount(0);
    await panel.getByText(mobile ? '演示日期控制' : 'Demo date controls', { exact: true }).click();
    const clock = panel.locator('details').filter({ has: page.locator('button', { hasText: /Advance demo date|推进模拟日期/ }) });
    await clock.locator('input').fill('2027-08-03');
    await clock.getByRole('button').click();
    await expect(task).toContainText(mobile ? '已逾期' : 'Overdue');
    assert.equal((await get(context, 'planning/profile/')).plan.status, 'CONFIRMED');
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-reminders.png`, output)), animations: 'disabled' });
    await task.getByRole('button', { name: /^(Mark completed|标记完成)$/ }).click();
    await expect(panel.locator('section').filter({ has: page.getByRole('heading', { name: /^(Upcoming reminders|近期提醒)$/ }) }).locator('[data-source^="task:"]')).toHaveCount(0);
    assert.equal((await get(context, 'planning/life/')).items.find(i => i.source_key === key).done, true);
    await panel.locator('[data-source^="enrollment:"]').getByRole('button', { name: /Review enrollment|核对报到/ }).click();
    const confirm = page.locator('#plan-chat').getByRole('button', { name: /^(Confirm|确认)$/ }).last();
    await confirm.click();
    await page.getByRole('dialog').getByRole('button', { name: /^(Confirm|确认)$/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.life-overview').getByRole('button', { name: /All tasks & budget|全部待办与预算/ }).click();
    const budget = panel.locator('.life-budget');
    await budget.getByRole('button', { name: /Edit budget|修改预算/ }).click();
    await budget.locator('form').first().locator('input').fill('6000');
    await save(budget.locator('form').first());
    await expect(budget).toContainText('6,000');
    await budget.locator('summary').click();
    await budget.getByLabel(/Spent amount|花费金额/).fill('120');
    await budget.getByLabel(/What was it for|花在什么地方/).fill('Lunch');
    await save(budget.locator('details form'));
    await expect(budget).toContainText('5,880');
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-budget.png`, output)), animations: 'disabled' });
    await budget.getByRole('button', { name: /Undo entry|撤销记录/ }).click();
    await expect(budget.getByRole('button', { name: /Undo entry|撤销记录/ })).toHaveCount(0);
    assert.equal((await get(context, 'planning/life/')).budget.remaining, '6000.00');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    evidence.journeys.push({ name, locale: mobile ? 'zh' : 'en', passed: ['chat task', 'acknowledge + reload', 'snooze + clock + overdue', 'completion', 'explicit enrollment', 'budget edit', 'expense + undo', 'no horizontal overflow'], pageErrors: errors });
    await page.goto(`${origin}/?plan=preview&stage=school&tool=life`);
    await expect(panel.locator('.life-budget')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Add task|添加待办/ })).toBeDisabled();
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-preview.png`, output)), animations: 'disabled' });
    await context.close();
  }
  writeFileSync(new URL('browser.json', output), JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
