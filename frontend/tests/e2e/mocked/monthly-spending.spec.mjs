import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { screenshot } from '../../support.mjs';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('studyflow.journey.v1:student', '2'));
});

async function monthlyFixture(page, { empty = false, fail = false } = {}) {
  const data = JSON.parse(readFileSync(new URL('../../../src/plan/preview-data/school.en.json', import.meta.url), 'utf8'));
  data.conversation.turns = [];
  const writes = [];
  const entries = empty ? [] : Array.from({ length: 53 }, (_, i) => ({ id: `e-${i}`, spent_on: '2026-10-12',
    category: i < 50 ? 'food' : i < 52 ? 'transport' : 'shopping', note: i < 50 ? `Lunch ${i + 1}` : i < 52 ? 'Train' : 'Unconverted purchase',
    amount: i < 50 ? '3.00' : i < 52 ? '25.00' : '100.00', currency: i === 52 ? 'JPY' : 'THB', via_agent: false }));
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (route.request().method() === 'POST') writes.push(path);
    if (path.endsWith('/messages/')) {
      const turn = { id: 'monthly-reply', kind: 'user', goal: route.request().postDataJSON().text,
        final_answer: 'Your monthly summary is ready.', status: 'COMPLETED', cards: [], pending_actions: [] };
      data.conversation.turns.push(turn);
      return route.fulfill({ json: { data: turn } });
    }
    if (path.endsWith('/planning/expenses/')) {
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Temporary outage' } });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return route.fulfill({ json: { data: { ...data.in_school.spending, month: '2026-10', spent: empty ? '0.00' : '200.00',
        remaining: empty ? '24300.00' : '24100.00', by_category: empty ? {} : { food: '150.00', transport: '50.00' },
        entries: entries.slice(offset, offset + 50), count: entries.length, next_offset: offset === 0 && !empty ? 50 : null,
        unconverted: empty ? [] : ['e-52'] } } });
    }
    const result = path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation
      : path.endsWith('/planning/in-school/') ? data.in_school : [];
    return route.fulfill({ json: { data: result } });
  });
  return { writes, recover: () => { fail = false; } };
}

test('monthly query opens details and full-month pie; pagination, close and history preserve chat', async ({ page }) => {
  const { writes } = await monthlyFixture(page);
  await page.addInitScript(() => localStorage.setItem('studyflow.lang', 'zh'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#plan-journey-guide')).toContainText('日常生活');
  const input = page.locator('.plan-composer textarea');
  await input.fill('我这月账单'); await input.press('Enter');
  const panel = page.locator('.monthly-report');
  await expect(panel.getByRole('img', { name: '支出分类占比' })).toBeVisible();
  await expect(panel.locator('.monthly-legend')).toContainText('75%');
  await expect(panel.locator('.monthly-legend')).toContainText('25%');
  // Entries load 50 at a time and the panel shows them eight rows per page instead of a long scroll.
  await panel.getByRole('tab', { name: /^明细/ }).click();
  await expect(panel.locator('.monthly-entries li')).toHaveCount(8);
  await expect(panel.getByRole('group', { name: '消费明细分页' })).toContainText('1 / 7');
  await panel.getByRole('button', { name: '下一项' }).click();
  await expect(panel.getByRole('group', { name: '消费明细分页' })).toContainText('2 / 7');
  await input.fill('下一条问题还没发送');
  await panel.getByRole('button', { name: '下一批' }).click();
  await expect(panel.locator('.monthly-entries li')).toHaveCount(3);
  await expect(panel.locator('.monthly-entries')).toContainText('未换算，不计入合计和占比');
  await expect(panel.locator('.monthly-legend')).toContainText('75%');
  await page.getByRole('button', { name: '关闭工具' }).click();
  await expect(input).toHaveValue('下一条问题还没发送');
  await page.goBack();
  await expect(panel.locator('.monthly-entries li')).toHaveCount(3);
  expect(writes.filter(path => !path.endsWith('/open/') && !path.endsWith('/messages/'))).toEqual([]);
});

test('monthly chart and details fit desktop and phone in both languages', async ({ page }) => {
  await monthlyFixture(page);
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?tool=spending&month=2026-10');
    for (const language of ['English', '中文']) {
      await page.getByRole('button', { name: language, exact: true }).click();
      await expect(page.locator('.monthly-pie')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: screenshot(`monthly-${width}-${language === 'English' ? 'en' : 'zh'}.png`) });
    }
    if (width === 375) {
      await page.keyboard.press('Escape');
      await expect(page.locator('.workspace-dock')).toBeHidden();
      await expect(page.locator('.plan-composer textarea')).toBeVisible();
    }
  }
});

test('empty month has no fabricated pie and failed reads can retry', async ({ page }) => {
  const fixture = await monthlyFixture(page, { empty: true, fail: true });
  await page.goto('/?tool=spending');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('.monthly-report [role="alert"]')).toBeVisible();
  fixture.recover();
  await page.locator('.monthly-report [role="alert"] button').click();
  await expect(page.locator('.monthly-empty')).toBeVisible();
  await expect(page.locator('.monthly-pie')).toHaveCount(0);
  await expect(page.locator('.monthly-entries')).toHaveCount(0);
});

test('monthly preview stays offline and never opens automatically from historic replies', async ({ page }) => {
  const calls = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request.url()); });
  await page.goto('/?plan=preview&stage=school');
  await expect(page.locator('.plan-chat')).toBeVisible();
  await expect(page.locator('.workspace-dock')).toBeHidden();
  await page.goto('/?plan=preview&stage=school&tool=spending');
  await expect(page.locator('.monthly-pie')).toBeVisible();
  expect(calls).toEqual([]);
});
