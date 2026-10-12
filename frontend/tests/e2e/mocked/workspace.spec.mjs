import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => ['student', 'student-one', 'student-two'].forEach(account => localStorage.setItem(`studyflow.journey.v1:${account}`, '2')));
});
import { readFileSync } from 'node:fs';
import { screenshot } from '../../support.mjs';

const recording = () => JSON.parse(readFileSync(new URL('../../../src/plan/preview-data/plan.en.json', import.meta.url), 'utf8'));
const openTool = async (page, name) => {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.locator('#workspace-tools').getByRole('button', { name, exact: true }).click();
};

test('preview tools preserve chat and wallet drafts, history and all student tools stay inside the workspace', async ({ page }) => {
  let calls = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => { calls++; return route.abort(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?plan=preview');
  await expect(page.locator('.workspace-card-summary').first()).toBeVisible();
  const conversation = page.locator('#plan-chat');
  const messageCount = await conversation.locator('.plan-turn').count();
  await page.locator('.plan-messages').evaluate(element => element.scrollTo({ top: 100, behavior: 'instant' }));
  await openTool(page, 'Wallet & transfers');
  await page.getByRole('tab', { name: 'Remit' }).click();
  await page.locator('#wallet-quote input').first().fill('1234');
  await page.getByRole('button', { name: 'Expand tool' }).click();
  await expect(page.locator('.workspace-dock')).toHaveAttribute('aria-modal', 'true');
  await page.getByRole('button', { name: 'Restore width' }).click();
  await openTool(page, 'Finance assistant');
  await expect(page.locator('#agent-result')).toBeVisible();
  await page.getByRole('button', { name: 'Previous tool' }).click();
  await expect(page.locator('#wallet-quote input').first()).toHaveValue('1234');
  await page.getByRole('button', { name: 'Close tool' }).click();
  await expect(conversation.locator('.plan-turn')).toHaveCount(messageCount);
  // Font metrics and scroll anchoring may round by a few pixels when restoring the column width.
  expect(await page.locator('.plan-messages').evaluate(element => Math.abs(element.scrollTop - 100))).toBeLessThanOrEqual(3);
  await page.goBack();
  await expect(page.locator('#wallet-quote input').first()).toHaveValue('1234');
  for (const [label, selector] of [['Loans', '.loans-app'], ['Family support', '.family-app'], ['Spending insights', '.insights-app'], ['Payments', '.payments-app'], ['Compare plans', '.copilot-app'], ['Permissions & activity', '.trust-app']]) {
    await openTool(page, label);
    await expect(page.locator(`.tool-content:not([hidden]) ${selector}`)).toBeVisible();
  }
  expect(calls).toBe(0);
  expect(errors).toEqual([]);
});

test('responsive bilingual workspace keeps composer visible and traps focus only in full-screen tools', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?plan=preview');
    await expect(page.locator('.workspace-card-summary').first()).toBeVisible();
    for (const lang of ['English', '中文']) {
      await page.getByRole('button', { name: lang, exact: true }).click();
      const chinese = lang === '中文';
      await expect(page.locator('.workspace-card-summary').first()).toBeVisible();
      const composer = await page.locator('.plan-composer').boundingBox();
      expect(composer.y + composer.height).toBeLessThanOrEqual(901);
      await page.screenshot({ path: screenshot(`workspace-chat-${width}-${chinese ? 'zh' : 'en'}.png`) });
      await page.locator('.workspace-plan-status').getByRole('button', { name: chinese ? '我的计划' : 'My plan', exact: true }).click();
      await expect(page.locator('#plan-summary')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width < 1100) {
        await expect(page.locator('.workspace-dock')).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('.workspace-conversation')).toHaveAttribute('inert', '');
        await page.locator('.workspace-dock-header button').first().focus();
        await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('.workspace-dock'))).toBe(true);
        await page.keyboard.press('Tab');
        await expect(page.locator('.workspace-dock-header button').first()).toBeFocused();
      } else await expect(page.locator('.workspace-conversation')).not.toHaveAttribute('inert', '');
      await page.screenshot({ path: screenshot(`workspace-tool-${width}-${chinese ? 'zh' : 'en'}.png`) });
      await page.keyboard.press('Escape');
      await expect(page.locator('.workspace-dock')).toBeHidden();
      await expect(page.locator('.workspace-plan-status').getByRole('button', { name: chinese ? '我的计划' : 'My plan', exact: true })).toBeFocused();
    }
  }
});

test('live conversation drafts survive tools and a confirmed account change clears them', async ({ page }) => {
  let username = 'student-one';
  const data = recording();
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: !!username, username, csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation
      : path.endsWith('/planning/in-school/') ? data.in_school : [];
    return route.fulfill({ json: { data: result } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const input = page.locator('.plan-composer textarea');
  await expect(input).toBeEnabled();
  await input.fill('Keep this unsent question');
  await page.locator('.workspace-plan-status').getByRole('button', { name: 'My plan', exact: true }).click();
  await page.getByRole('button', { name: 'Close tool' }).click();
  await expect(input).toHaveValue('Keep this unsent question');
  username = 'student-two';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(input).toHaveValue('');
  await expect(page.locator('.workspace-account')).toHaveText('student-two');
});

test('a planning money proposal opens its original finance session and refresh failure never resubmits it', async ({ page }) => {
  const data = recording();
  const expires = new Date(Date.now() + 600000).toISOString();
  const pending = { id: 'pending-original', session: 'session-original', action: 'wallet.convert', target_id: 'quote-original',
    amount: '200.00', currency: 'CNY', arguments: {}, status: 'PENDING', expires_at: expires, version: 1, created_at: new Date().toISOString() };
  const session = { id: pending.session, goal: 'Convert 200 CNY', mode: 'mock', status: 'COMPLETED', steps: [], pending_actions: [pending], created_at: new Date().toISOString(), final_answer: 'Please review this conversion.' };
  data.conversation.turns = [{ id: session.id, goal: session.goal, final_answer: session.final_answer, pending_actions: [pending], cards: [
    { type: 'confirmation', action: pending.action, pending_action_id: pending.id, expires_at: expires, amount: pending.amount, currency: pending.currency, details: {} },
  ] }];
  const writes = [];
  let stale = false;
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v2/', '');
    const post = route.request().method() === 'POST';
    if (post) writes.push(path);
    if (path === 'agent/conversations/') return route.fulfill({ json: { data: [{ id: data.conversation.id }] } });
    if (path.includes('agent/conversations/')) return route.fulfill(stale && !post
      ? { status: 503, json: { detail: 'temporarily unavailable' } } : { json: { data: data.conversation } });
    if (path === 'planning/in-school/') return route.fulfill({ json: { data: data.in_school } });
    if (path === 'planning/family-links/') return route.fulfill({ json: { data: [] } });
    if (path === 'agent/sessions/session-original/') return route.fulfill({ json: { data: session } });
    if (path === 'agent/sessions/') return route.fulfill({ json: { count: 1, results: [session], next: null } });
    if (path === 'approvals/') return route.fulfill({ json: { count: 0, results: [], next: null } });
    if (path === 'auth/step-up/') return route.fulfill({ json: { token: 'test-grant' } });
    if (path === 'agent/pending-actions/pending-original/confirm/') {
      expect(route.request().headers()['x-step-up-token']).toBe('test-grant');
      pending.status = 'CONFIRMED'; pending.result = { status: 'COMPLETED' }; stale = true;
      return route.fulfill({ json: { data: pending } });
    }
    return route.fulfill({ status: 404, json: { detail: path } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.plan-card-confirm button').click();
  await expect(page.locator('#proposal-pending-original')).toBeVisible();
  expect(writes).not.toContain('agent/sessions/');
  await page.locator('#proposal-pending-original').getByRole('button', { name: 'Confirm with password' }).click();
  await page.getByRole('dialog').getByLabel('Password').fill('not-stored');
  await page.keyboard.press('Escape');
  await page.locator('#proposal-pending-original').getByRole('button', { name: 'Confirm with password' }).click();
  await expect(page.getByRole('dialog').getByLabel('Password')).toHaveValue('');
  await page.getByRole('dialog').getByLabel('Password').fill('test-password');
  await page.getByRole('dialog').getByRole('button', { name: 'Authorize and confirm' }).click();
  await expect(page.locator('#proposal-pending-original').getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(page.locator('.workspace-conversation .workspace-stale')).toBeVisible();
  stale = false;
  await page.locator('.workspace-conversation .workspace-stale button').click();
  await expect(page.locator('.workspace-conversation .workspace-stale')).toHaveCount(0);
  expect(writes.filter(path => path.endsWith('/confirm/'))).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }) + location.href)).not.toContain('test-password');
});


test('reopened tools refresh records, preserve expense drafts, clear sponsor tokens and show mobile API failures', async ({ page }) => {
  const data = JSON.parse(readFileSync(new URL('../../../src/plan/preview-data/school.en.json', import.meta.url), 'utf8'));
  let reads = 0;
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/planning/expenses/record/')) return route.fulfill({ status: 503, json: { message: 'Expense service unavailable' } });
    if (path.endsWith('/planning/in-school/')) { reads++; return route.fulfill({ json: { data: data.in_school } }); }
    const result = path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation : [];
    return route.fulfill({ json: { data: result } });
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  await expect(page.locator('.plan-composer textarea')).toBeEnabled();
  await openTool(page, 'Bills & spending');
  await page.getByRole('tab', { name: 'Record spending' }).click();
  await page.locator('.plan-expense input').first().fill('222');
  await openTool(page, 'Family links');
  await page.locator('[data-sensitive]').fill('a'.repeat(64));
  const before = reads;
  await openTool(page, 'Bills & spending');
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.locator('.plan-expense input').first()).toHaveValue('222');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#plan-school').getByRole('alert')).toHaveText('Expense service unavailable');
  await openTool(page, 'Family links');
  await expect(page.locator('[data-sensitive]')).toHaveValue('');
});

test('signed-in students can sign out from the workspace header', async ({ page }) => {
  let signedIn = true;
  const logouts = [];
  await page.route('**/api/auth/session/', route => route.fulfill({ json: signedIn
    ? { authenticated: true, username: 'demo-approver', csrf_token: 'csrf-1' } : { authenticated: false, csrf_token: 'csrf-2' } }));
  await page.route('**/api/auth/logout/', route => {
    logouts.push({ method: route.request().method(), token: route.request().headers()['x-csrftoken'] });
    signedIn = false;
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.route('**/api/v2/**', route => route.fulfill({ status: 404, json: { detail: 'not mocked' } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.workspace-account')).toHaveText('demo-approver');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => logouts).toEqual([{ method: 'POST', token: 'csrf-1' }]);
  // After the reload the session reads signed out, so the header offers no sign-out.
  await expect(page.locator('.workspace-account')).not.toHaveText('demo-approver');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(page).toHaveURL(/127\.0\.0\.1:5173\/$|localhost:5173\/$/);
});
