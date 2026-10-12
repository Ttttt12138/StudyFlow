import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { screenshot } from '../../support.mjs';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('studyflow.journey.v1:student', '2'));
});

const sample = () => JSON.parse(readFileSync(new URL('../../../src/plan/preview-data/school.en.json', import.meta.url), 'utf8'));

test('preparation and daily-life guidance fit both languages at desktop and phone widths', async ({ page }) => {
  const data = sample();
  let status = 'CONFIRMED';
  const writes = [];
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') writes.push(path);
    const conversation = { ...data.conversation, plan: { ...data.conversation.plan, status }, turns: [] };
    const result = path.endsWith('/agent/conversations/') ? [{ id: conversation.id }]
      : path.includes('/agent/conversations/') ? conversation
      : path.endsWith('/planning/in-school/') ? status === 'ENROLLED' ? data.in_school : { enrolled: false } : [];
    return route.fulfill({ json: { data: result } });
  });
  for (const phase of ['CONFIRMED', 'ENROLLED']) {
    status = phase;
    for (const width of [1440, 1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      for (const lang of ['English', '中文']) {
        await page.getByRole('button', { name: lang, exact: true }).click();
        const guide = page.locator('#plan-journey-guide');
        await expect(guide).toBeVisible();
        await guide.scrollIntoViewIfNeeded();
        await expect(guide).toContainText(phase === 'CONFIRMED'
          ? lang === 'English' ? 'not an admission offer' : '不代表已经录取'
          : lang === 'English' ? 'has not paid any bill' : '没有支付任何账单');
        expect(await page.locator('.plan-composer').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: screenshot(`transition-${phase}-${width}-${lang === 'English' ? 'en' : 'zh'}.png`) });
      }
    }
  }
  expect(writes.filter(path => !path.endsWith('/open/'))).toEqual([]);
});

test('not-ready and changed-date choices send messages; registration opens the original confirmation before writing', async ({ page }) => {
  const data = sample();
  const expires = new Date(Date.now() + 600000).toISOString();
  const pending = { id: 'arrival', session: 'arrival-turn', action: 'plan.enroll', status: 'PENDING', expires_at: expires };
  const conversation = { ...data.conversation, plan: { ...data.conversation.plan, status: 'CONFIRMED' }, turns: [{
    id: 'arrival-turn', kind: 'assistant', goal: '', final_answer: 'Have you completed registration?', status: 'COMPLETED',
    cards: [{ type: 'confirmation', action: 'plan.enroll', pending_action_id: pending.id, expires_at: expires, plan: data.conversation.plan }], pending_actions: [pending],
  }] };
  const messages = [], confirmations = [];
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/messages/')) {
      const goal = route.request().postDataJSON().text; messages.push(goal);
      const turn = { id: `reply-${messages.length}`, goal, final_answer: 'We can continue preparing.', status: 'COMPLETED', cards: [], pending_actions: [] };
      conversation.turns.push(turn);
      return route.fulfill({ json: { data: turn } });
    }
    if (path.endsWith('/confirm/')) {
      confirmations.push(path); pending.status = 'CONFIRMED'; conversation.plan.status = 'ENROLLED';
      return route.fulfill({ json: { data: pending } });
    }
    const result = path.endsWith('/agent/conversations/') ? [{ id: conversation.id }]
      : path.includes('/agent/conversations/') ? conversation
      : path.endsWith('/planning/in-school/') ? { enrolled: false } : [];
    return route.fulfill({ json: { data: result } });
  });
  await page.goto('/');
  const guide = page.locator('#plan-journey-guide');
  await guide.getByRole('button', { name: 'Still preparing' }).click();
  await expect.poll(() => messages.length).toBe(1);
  await guide.getByRole('button', { name: 'My start date has changed' }).click();
  await expect.poll(() => messages.length).toBe(2);
  expect(confirmations).toEqual([]);
  await guide.getByRole('button', { name: 'Registration completed' }).click();
  const modal = page.getByRole('dialog', { name: 'Review and confirm' });
  await expect(modal).toBeVisible();
  expect(confirmations).toEqual([]);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await guide.getByRole('button', { name: 'Registration completed' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(guide).toContainText('Daily life');
  expect(confirmations).toEqual(['/api/v2/agent/pending-actions/arrival/confirm/']);
});
