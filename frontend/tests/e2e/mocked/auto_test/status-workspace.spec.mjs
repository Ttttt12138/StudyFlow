import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { screenshot } from '../../../support.mjs';

const recording = () => JSON.parse(readFileSync(new URL('../../../../src/plan/preview-data/school.zh.json', import.meta.url), 'utf8'));
async function setup(page, phase = 'ENROLLED') {
  const data = recording();
  data.conversation.plan.status = phase;
  data.conversation.plan.start_date = '2026-11-02';
  data.conversation.turns = [{ id: 'rail-turn', goal: '今天午饭花了120泰铢，帮我记一下。',
    final_answer: '已记录午餐支出 120 THB，归入餐饮。\n本月已记支出 8,620 THB，预算剩余 15,680 THB。\n\n10月15日有一笔住宿账单待处理，可以提前安排预算。',
    kind: 'user', status: 'COMPLETED', error_code: '', created_at: '2026-10-12T03:14:00Z', cards: [], pending_actions: [] }];
  const bill = { id: 'rent', label: { en: 'Housing', zh: '住宿费' }, due_date: '2026-10-15', currency: 'THB', amount: '6500', status: 'DUE', paid_at: null, kind: 'housing' };
  data.in_school = { ...data.in_school, enrolled: true, today: '2026-10-12', bills: [bill], upcoming_bills: [bill], overdue: [], bill_count: 1,
    spending: { month: '2026-10', currency: 'THB', budget: '24300', spent: '8620', remaining: '15680', over_budget: false, by_category: { food: '8620' }, recent: [], unconverted: [] } };
  const state = { data, writes: [], account: 'orbital-student', fail: false };
  await page.addInitScript(() => localStorage.setItem('studyflow.journey.v1:orbital-student', '2'));
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: !!state.account, username: state.account, csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && !path.endsWith('/open/')) state.writes.push(path);
    if (!state.account) return route.fulfill({ status: 401, json: { detail: 'Sign in' } });
    if (state.fail && path.endsWith('/planning/in-school/')) return route.fulfill({ status: 500, json: { detail: 'Unavailable' } });
    return route.fulfill({ json: { data: path.includes('/planning/schools/') ? { school: { key: 'chulalongkorn', school: { country: { en: 'Thailand', zh: '泰国' }, city: { en: 'Bangkok', zh: '曼谷' } } } }
      : path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation : path.endsWith('/planning/in-school/') ? data.in_school
      : path.includes('/planning/expenses/') ? { ...data.in_school.spending, entries: [], count: 0, next_offset: null } : [] } });
  });
  return state;
}

test('all phases and languages have readable rails, with no overflow or hidden composer', async ({ page }) => {
  const state = await setup(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const phase of ['DRAFT', 'CONFIRMED', 'ENROLLED']) {
    state.data.conversation.plan.status = phase;
    for (const width of [1440, 1024, 375]) for (const lang of ['en', 'zh']) {
      await page.addInitScript(value => localStorage.setItem('studyflow.lang', value), lang);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('.plan-turn')).toHaveCount(1);
      await expect(page.locator('.plan-composer textarea')).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      const composer = await page.locator('.plan-composer').boundingBox();
      expect(composer.y + composer.height).toBeLessThanOrEqual(901);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1440) {
        await expect(page.locator('.workspace-left-rail')).toBeVisible();
        await expect(page.locator('.workspace-right-rail')).toBeVisible();
      } else {
        await expect(page.locator('.workspace-left-rail')).toBeHidden();
        await expect(page.locator('.workspace-right-rail')).toBeHidden();
      }
      await page.screenshot({ path: screenshot(`orbital-${phase}-${width}-${lang}.png`) });
    }
  }
  expect(errors).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('returning to a reached phase preserves actual enrollment and draft; rail actions open tools', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.addInitScript(() => localStorage.setItem('studyflow.lang', 'zh'));
  await page.goto('/');
  const input = page.locator('.plan-composer textarea');
  await expect(page.locator('.budget-arc')).toContainText('35.5%');
  await page.screenshot({ path: screenshot('orbital-reference-state.png') });
  await input.fill('保留这条草稿');
  await page.locator('.workspace-left-rail .journey-stop').nth(1).click();
  await expect(page.locator('.workspace-right-rail')).toContainText('计划入学日期');
  await expect(page.locator('.workspace-left-rail [aria-current="step"]')).toContainText('生活助手');
  await expect(input).toHaveValue('保留这条草稿');
  await page.locator('.workspace-left-rail .journey-stop').nth(2).click();
  await page.locator('.workspace-right-rail').getByRole('button', { name: '查看消费明细' }).click();
  await expect(page.locator('.monthly-report')).toContainText('8,620');
  await expect(page.locator('.workspace-right-rail')).toBeHidden();
  await page.getByRole('button', { name: '关闭工具' }).click();
  await expect(input).toHaveValue('保留这条草稿');
  await expect(page.locator('.workspace-right-rail')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.monthly-report')).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('mobile status manages focus, hands off to tools and keeps the conversation', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  const input = page.locator('.plan-composer textarea');
  await input.fill('Keep this draft');
  await page.getByRole('button', { name: 'Journey & status', exact: true }).click();
  const overview = page.getByRole('dialog', { name: 'Journey & status' });
  await expect(overview).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.screenshot({ path: screenshot('orbital-mobile-overview.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Journey & status', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Journey & status', exact: true }).click();
  await overview.getByRole('button', { name: 'View expense details' }).click();
  await expect(page.locator('.monthly-report')).toBeVisible();
  await expect(overview).toHaveCount(0);
  await page.getByRole('button', { name: 'Close tool' }).click();
  await expect(input).toHaveValue('Keep this draft');
});

test('budget exceptions, stale refresh and sign-out do not produce false or leaked status', async ({ page }) => {
  const state = await setup(page);
  state.data.in_school.spending = { ...state.data.in_school.spending, spent: '300', budget: '200', remaining: '-100', unconverted: ['entry'] };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.budget-arc')).toContainText('150% used');
  await expect(page.locator('.rail-warning')).toContainText('excluded');
  state.data.in_school.spending.budget = '0';
  state.data.in_school.upcoming_bills = [];
  state.data.in_school.bills = [];
  await page.reload();
  await expect(page.locator('.budget-arc')).toContainText('Budget not available');
  await expect(page.locator('.status-bills')).toContainText('No unpaid bills');
  state.fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('studyflow:write')));
  await expect(page.locator('.workspace-stale')).toBeVisible();
  state.fail = false;
  await page.locator('.workspace-stale').getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('.workspace-stale')).toHaveCount(0);
  state.account = '';
  await page.evaluate(() => window.dispatchEvent(new Event('studyflow:auth-lost')));
  await expect(page.locator('.plan-welcome')).toBeVisible();
  await expect(page.locator('.workspace-left-rail')).toHaveCount(0);
  await expect(page.locator('.budget-arc')).toHaveCount(0);
});

test('preview finance shortcuts open their sections with no API writes', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?plan=preview&stage=school');
  await page.locator('.workspace-right-rail').getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(page).toHaveURL(/section=convert/);
  await expect(page.locator('#wallet-convert')).toBeInViewport();
  await page.getByRole('button', { name: 'Close tool' }).click();
  await page.locator('.workspace-right-rail').getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(page).toHaveURL(/section=quote/);
  await expect(page.locator('#wallet-quote')).toBeInViewport();
  await page.reload();
  await expect(page.locator('#wallet-quote')).toBeInViewport();
  expect(requests).toEqual([]);
});
