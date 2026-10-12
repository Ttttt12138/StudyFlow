import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { screenshot } from '../../support.mjs';

async function setup(page) {
  const data = JSON.parse(readFileSync(new URL('../../../src/plan/preview-data/school.en.json', import.meta.url), 'utf8'));
  const state = { phase: 'DRAFT', account: 'intro-student', confirmations: [] };
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: !!state.account, username: state.account, csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/confirm/')) {
      state.confirmations.push(path); state.phase = state.phase === 'DRAFT' ? 'CONFIRMED' : 'ENROLLED';
      return route.fulfill({ json: { data: { status: 'CONFIRMED' } } });
    }
    const plan = { ...data.conversation.plan, status: state.phase };
    const pending = { id: state.phase, session: 'turn', action: state.phase === 'DRAFT' ? 'plan.confirm' : 'plan.enroll', status: 'PENDING', expires_at: new Date(Date.now() + 600000).toISOString() };
    const turns = state.phase === 'ENROLLED' ? [] : [{ id: 'turn', goal: '', final_answer: 'Review your next step.', status: 'COMPLETED',
      cards: [{ type: 'confirmation', action: pending.action, pending_action_id: pending.id, plan, expires_at: pending.expires_at }], pending_actions: [pending] }];
    const conversation = { ...data.conversation, plan, turns };
    return route.fulfill({ json: { data: path.endsWith('/agent/conversations/') ? [{ id: conversation.id }]
      : path.includes('/agent/conversations/') ? conversation : path.endsWith('/planning/in-school/') ? { enrolled: false } : [] } });
  });
  return state;
}

test('introduction focuses each real transition after confirmation, never overlaps confirmation or writes on skip', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/');
  const intro = page.locator('dialog.journey-intro');
  await expect(intro.locator('[aria-current="step"]')).toHaveAttribute('data-phase', '0');
  await intro.getByRole('button', { name: 'Start consultation' }).click();
  await page.reload();
  await expect(page.locator('.plan-chat')).toBeVisible();
  await expect(intro).toHaveCount(0);
  for (const phase of [1, 2]) {
    await page.locator('.plan-card-confirm').getByRole('button', { name: 'Confirm', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Review and confirm' });
    await expect(intro).toHaveCount(0);
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(intro).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(intro.locator('[aria-current="step"]')).toHaveAttribute('data-phase', String(phase));
    await expect(intro.locator('.is-focused')).toHaveAttribute('data-phase', String(phase));
    await intro.getByRole('button', { name: 'Skip introduction' }).click();
  }
  expect(state.confirmations).toHaveLength(2);
  await page.getByRole('button', { name: 'View journey', exact: true }).click();
  await intro.locator('[data-phase="0"]').click();
  await expect(intro.locator('[aria-current="step"]')).toHaveAttribute('data-phase', '2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'View journey', exact: true })).toBeFocused();
  expect(state.phase).toBe('ENROLLED');
});

test('cards fit three widths and languages with the actual stage in focus', async ({ page }) => {
  const state = await setup(page);
  for (const [index, phase] of ['DRAFT', 'CONFIRMED', 'ENROLLED'].entries()) {
    state.phase = phase;
    for (const width of [1440, 1024, 375]) for (const lang of ['en', 'zh']) {
      state.account = `visual-${index}-${width}-${lang}`;
      await page.addInitScript(value => localStorage.setItem('studyflow.lang', value), lang);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const intro = page.locator('dialog.journey-intro');
      await expect(intro).toBeVisible();
      await intro.evaluate(element => Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)));
      expect(await intro.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await expect(intro.locator('[aria-current="step"]')).toHaveAttribute('data-phase', String(index));
      await expect(intro.locator('[aria-current="step"]')).toBeFocused();
      expect(await intro.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await intro.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
      await page.screenshot({ path: screenshot(`intro-${index}-${width}-${lang}.png`) });
    }
  }
});

test('reduced motion, account isolation and direct tool entry', async ({ page }) => {
  const state = await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?tool=plan');
  await expect(page.locator('#plan-summary')).toBeVisible();
  await expect(page.locator('dialog.journey-intro')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close tool' }).click();
  const intro = page.locator('dialog.journey-intro');
  await expect(intro).toBeVisible();
  expect(await intro.locator('.is-focused').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await intro.locator('.journey-intro-ambient span').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.keyboard.press('Tab');
  expect(await intro.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  state.account = 'another-student';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(intro).toBeVisible();
  state.account = '';
  await page.evaluate(() => window.dispatchEvent(new Event('studyflow:auth-lost')));
  await expect(intro).toHaveCount(0);
});

test('preview can replay the guide without requests or acknowledgement writes', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto('/?plan=preview&stage=school');
  await page.getByRole('button', { name: 'View journey', exact: true }).click();
  const intro = page.locator('dialog.journey-intro');
  await expect(intro.locator('[aria-current="step"]')).toHaveAttribute('data-phase', '2');
  await expect(intro).toContainText('currency exchange, remittances and loans');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('studyflow.journey.')))).toEqual([]);
  expect(requests).toEqual([]);
});
