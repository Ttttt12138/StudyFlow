import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { screenshot } from '../../support.mjs';

// Spending is part of "This month" (planning/life/): the month's budget, a category pie and the latest entries.
const read = name => JSON.parse(readFileSync(new URL(`../../../src/plan/preview-data/${name}.json`, import.meta.url), 'utf8'));

async function monthlyFixture(page, { empty = false, fail = false } = {}) {
  const data = read('school.en');
  data.conversation.turns = [];
  const life = read('life.school.en');
  life.budget = { ...life.budget, spent: empty ? '0.00' : '200.00', remaining: empty ? '24300.00' : '24100.00',
    by_category: empty ? {} : { food: '150.00', transport: '50.00' }, unconverted: empty ? [] : ['e-3'],
    recent: empty ? [] : [
      { id: 'e-1', spent_on: '2027-08-14', category: 'food', amount: '150.00', currency: 'THB', note: 'Lunches', via_agent: false },
      { id: 'e-2', spent_on: '2027-08-13', category: 'transport', amount: '50.00', currency: 'THB', note: 'Train', via_agent: false },
      { id: 'e-3', spent_on: '2027-08-12', category: 'shopping', amount: '100.00', currency: 'JPY', note: 'Unconverted purchase', via_agent: false },
      { id: 'e-4', spent_on: '2027-08-11', category: 'food', amount: '10.00', currency: 'THB', note: 'Older entry', via_agent: false }] };
  const writes = [];
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') writes.push(path);
    if (path.endsWith('/messages/')) {
      const turn = { id: 'monthly-reply', kind: 'user', goal: route.request().postDataJSON().text,
        final_answer: 'Your monthly summary is ready.', status: 'COMPLETED', cards: [], pending_actions: [] };
      data.conversation.turns.push(turn);
      return route.fulfill({ json: { data: turn } });
    }
    if (path.endsWith('/planning/life/')) return fail ? route.fulfill({ status: 503, json: { detail: 'Temporary outage', message: 'Temporary outage' } })
      : route.fulfill({ json: { data: life } });
    const result = path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation
      : path.endsWith('/planning/in-school/') ? data.in_school : [];
    return route.fulfill({ json: { data: result } });
  });
  return { writes, recover: () => { fail = false; } };
}

test('a monthly question opens This month with the category pie and the latest entries; closing keeps the draft', async ({ page }) => {
  const { writes } = await monthlyFixture(page);
  await page.addInitScript(() => localStorage.setItem('studyflow.lang', 'zh'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#plan-journey-guide')).toContainText('日常生活');
  const input = page.locator('.plan-composer textarea');
  await input.fill('我这月账单'); await input.press('Enter');
  await expect(page.locator('#workspace-tool-title')).toHaveText('本月');
  const spending = page.locator('.life-spending');
  await expect(spending.getByRole('img', { name: '支出分类占比' })).toBeVisible();
  await expect(spending.locator('.monthly-legend')).toContainText('75%');
  await expect(spending.locator('.monthly-legend')).toContainText('25%');
  // The three latest entries, each with undo; an unconverted entry is flagged rather than counted.
  await expect(spending.locator('.panel-rows li')).toHaveCount(3);
  await expect(spending).not.toContainText('Older entry');
  await expect(spending.locator('.panel-note')).toBeVisible();
  await expect(page.locator('.life-summary')).toContainText('已花');
  await input.fill('下一条问题还没发送');
  await page.getByRole('button', { name: '关闭工具' }).click();
  await expect(input).toHaveValue('下一条问题还没发送');
  await page.goBack();
  await expect(spending.locator('.panel-rows li')).toHaveCount(3);
  expect(writes.filter(path => !path.endsWith('/open/') && !path.endsWith('/messages/'))).toEqual([]);
});

test('This month fits desktop and phone in both languages, and old spending links land there', async ({ page }) => {
  await monthlyFixture(page);
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?tool=spending&month=2026-10');
    for (const language of ['English', '中文']) {
      await page.getByRole('button', { name: language, exact: true }).click();
      await expect(page.locator('.life-spending .monthly-pie')).toBeVisible();
      await expect(page.locator('.workspace-dock details')).toHaveCount(0);
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

test('an empty month has no fabricated pie and a failed read can retry', async ({ page }) => {
  const fixture = await monthlyFixture(page, { empty: true, fail: true });
  await page.goto('/?tool=life');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const alert = page.locator('.life-panel [role="alert"]');
  await expect(alert).toBeVisible();
  fixture.recover();
  await alert.getByRole('button').click();
  await expect(page.locator('.life-spending .monthly-empty')).toBeVisible();
  await expect(page.locator('.monthly-pie')).toHaveCount(0);
});

test('the preview stays offline and never opens This month automatically from historic replies', async ({ page }) => {
  const calls = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request.url()); });
  await page.goto('/?plan=preview&stage=school');
  await expect(page.locator('.plan-chat')).toBeVisible();
  await expect(page.locator('.workspace-dock')).toBeHidden();
  await page.goto('/?plan=preview&stage=school&tool=spending');
  await expect(page.locator('.life-spending .monthly-pie')).toBeVisible();
  expect(calls).toEqual([]);
});
