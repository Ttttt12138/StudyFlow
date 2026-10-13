import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { screenshot } from '../../support.mjs';

const recording = (name = 'plan') => JSON.parse(readFileSync(new URL(`../../../src/plan/preview-data/${name}.en.json`, import.meta.url), 'utf8'));
const sidebar = page => page.getByRole('navigation', { name: 'Tools' });
// Wide screens keep the tool sidebar on the left; below 1100px it is a drawer behind the top-left "Tools" button.
const openSidebar = async page => {
  const menu = page.locator('.workspace-menu-button');
  if (!await menu.isVisible() || await menu.getAttribute('aria-expanded') === 'true') return;
  // A phone tool is a full-screen dialog over the top bar: close it to reach the drawer again.
  if (await page.locator('.workspace-dock').isVisible()) await page.getByRole('button', { name: 'Close tool' }).click();
  await menu.click();
};
// Items match on the start of their name: "My plan" also carries a "Funding gap" dot.
const startsWith = name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const openTool = async (page, name) => {
  await openSidebar(page);
  await sidebar(page).getByRole('button', { name: startsWith(name) }).click();
};
// The expense form opens from the enrolled guide in the conversation (and from the monthly spending panel).
const openRecord = async page => {
  if (await page.locator(".workspace-dock").isVisible()) await page.getByRole("button", { name: "Close tool" }).click();
  await page.locator("#plan-journey-guide").getByRole("button", { name: "Record expense", exact: true }).click();
};
const openSetting = async (page, name) => {
  await openSidebar(page);
  await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#side-settings').getByRole('button', { name, exact: true }).click();
};

test('preview tools preserve chat and wallet drafts, history and all student tools stay inside the workspace', async ({ page }) => {
  let calls = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => { calls++; return route.abort(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The money tools belong to the enrolled stage of the recorded preview.
  await page.goto('/?plan=preview&stage=school');
  const conversation = page.locator('#plan-chat');
  await expect(conversation.locator('.plan-turn').first()).toBeVisible();
  const messageCount = await conversation.locator('.plan-turn').count();
  await page.locator('.plan-messages').evaluate(element => element.scrollTo({ top: 100, behavior: 'instant' }));
  // Wallet, exchange, remittance and payments are one tool with one tab row.
  await openTool(page, 'Wallet & payments');
  await expect(page.locator('#workspace-tool-title')).toHaveText('Wallet & payments');
  await page.getByRole('tablist', { name: 'Wallet & payments' }).getByRole('tab', { name: 'Remit' }).click();
  await page.locator('#wallet-quote input').first().fill('1234');
  await page.getByRole('button', { name: 'Expand tool' }).click();
  await expect(page.locator('.workspace-dock')).toHaveAttribute('aria-modal', 'true');
  await page.getByRole('button', { name: 'Restore width' }).click();
  await openTool(page, "This month's spending");
  await expect(page.locator('.tool-content:not([hidden]) .monthly-report')).toBeVisible();
  await page.getByRole('button', { name: 'Previous tool' }).click();
  await expect(page.locator('#wallet-quote input').first()).toHaveValue('1234');
  await page.getByRole('button', { name: 'Close tool' }).click();
  await expect(conversation.locator('.plan-turn')).toHaveCount(messageCount);
  // Scroll anchoring may shift by a few lines while tools mount beside the chat; the list must not jump to the end or the top.
  expect(await page.locator('.plan-messages').evaluate(element => Math.abs(element.scrollTop - 100))).toBeLessThanOrEqual(32);
  await page.goBack();
  await expect(page.locator('#wallet-quote input').first()).toHaveValue('1234');
  for (const [label, selector, setting] of [['My loans', '.loans-app'], ["This month's spending", '.monthly-report'],
    ['To-dos & payments', '.life-panel'], ['Wallet & payments', '#wallet-balances'], ['Credit record', '.trust-app', true]]) {
    await (setting ? openSetting : openTool)(page, label);
    await expect(page.locator('#workspace-tool-title')).toHaveText(label);
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
    await expect(page.locator('#plan-chat .plan-turn').first()).toBeVisible();
    for (const lang of ['English', '中文']) {
      await page.getByRole('button', { name: lang, exact: true }).click();
      const chinese = lang === '中文';
      await expect(page.locator('#plan-chat .plan-turn').first()).toBeVisible();
      const composer = await page.locator('.plan-composer').boundingBox();
      expect(composer.y + composer.height).toBeLessThanOrEqual(901);
      await page.screenshot({ path: screenshot(`workspace-chat-${width}-${chinese ? 'zh' : 'en'}.png`) });
      if (width < 1100) {
        await page.getByRole('button', { name: chinese ? '工具' : 'Tools', exact: true }).click();
        await page.getByRole('navigation', { name: chinese ? '工具' : 'Tools' }).waitFor();
      }
      const myPlan = page.getByRole('navigation', { name: chinese ? '工具' : 'Tools' }).getByRole('button', { name: chinese ? /^我的方案/ : /^My plan/ });
      await myPlan.click();
      await expect(page.locator('.workspace-dock')).toBeVisible();
      await expect(page.locator('#workspace-tool-title')).toHaveText(chinese ? '我的方案' : 'My plan');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width < 1100) {
        await expect(page.locator('.workspace-dock')).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('.workspace-main')).toHaveAttribute('inert', '');
        await page.locator('.workspace-dock-header button').first().focus();
        await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('.workspace-dock'))).toBe(true);
        await page.keyboard.press('Tab');
        await expect(page.locator('.workspace-dock-header button').first()).toBeFocused();
      } else await expect(page.locator('.workspace-main')).not.toHaveAttribute('inert', '');
      await page.screenshot({ path: screenshot(`workspace-tool-${width}-${chinese ? 'zh' : 'en'}.png`) });
      await page.keyboard.press('Escape');
      await expect(page.locator('.workspace-dock')).toBeHidden();
      // Wide: focus returns to the sidebar item that opened the tool. On phones the drawer item is gone and the app
      // falls back to the composer, which is disabled in the read-only preview, so only the wide case is asserted.
      if (width >= 1100) await expect(myPlan).toBeFocused();
      else await expect(page.locator('.workspace-menu-button')).toBeVisible();
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
      : path.endsWith('/planning/in-school/') ? data.in_school
      : path.endsWith('/planning/life/') ? recording('life.plan') : [];
    return route.fulfill({ json: { data: result } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const input = page.locator('.plan-composer textarea');
  await expect(input).toBeEnabled();
  await input.fill('Keep this unsent question');
  await openTool(page, 'School comparison');
  await page.getByRole('button', { name: 'Close tool' }).click();
  // The mock answers the funding panel with a bare list: the panel reports it and the workspace keeps working.
  await openTool(page, 'My plan');
  await expect(page.locator('.workspace-dock').getByText('This section could not load.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close tool' }).click();
  await expect(input).toHaveValue('Keep this unsent question');
  username = 'student-two';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(input).toHaveValue('');
  await expect(page.locator('.workspace-account')).toHaveText('student-two');
});



test('reopened tools refresh records, preserve expense drafts, clear sponsor tokens and show mobile API failures', async ({ page }) => {
  const data = recording('school');
  let reads = 0;
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'student', csrf_token: 'mock' } }));
  await page.route('**/api/v2/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/planning/expenses/record/')) return route.fulfill({ status: 503, json: { message: 'Expense service unavailable' } });
    if (path.endsWith('/planning/in-school/')) { reads++; return route.fulfill({ json: { data: data.in_school } }); }
    if (path.endsWith('/planning/life/')) return route.fulfill({ json: { data: recording('life.school') } });
    const result = path.endsWith('/agent/conversations/') ? [{ id: data.conversation.id }]
      : path.includes('/agent/conversations/') ? data.conversation : [];
    return route.fulfill({ json: { data: result } });
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  await expect(page.locator('.plan-composer textarea')).toBeEnabled();
  // The recorded conversation's plan is enrolled, so the life tools are offered once it has loaded.
  await expect(page.locator('.workspace-stage')).toHaveText('Enrolled');
  await expect(page.locator('#plan-chat .plan-turn').first()).toBeVisible();
  await openRecord(page);
  await page.getByRole('tab', { name: 'Record spending' }).click();
  await page.locator('.plan-expense input').first().fill('222');
  await openSetting(page, 'Link a family account');
  await page.locator('[data-sensitive]').fill('a'.repeat(64));
  const before = reads;
  await openRecord(page);
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.locator('.plan-expense input').first()).toHaveValue('222');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#plan-school').getByRole('alert')).toHaveText('Expense service unavailable');
  await openSetting(page, 'Link a family account');
  await expect(page.locator('[data-sensitive]')).toHaveValue('');
});

test('signed-in students can sign out from the sidebar settings', async ({ page }) => {
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
  await openSetting(page, 'Sign out');
  await expect.poll(() => logouts).toEqual([{ method: 'POST', token: 'csrf-1' }]);
  // After the reload the session reads signed out: the top bar offers sign-in and the settings menu no sign-out.
  await expect(page.locator('.workspace-account')).toHaveCount(0);
  const signIn = page.locator('.workspace-topbar').getByRole('link', { name: 'Sign in', exact: true });
  await expect(signIn).toHaveAttribute('href', /^\/auth\?next=/);
  await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#side-settings')).toBeVisible();
  await expect(page.locator('#side-settings').getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(page).toHaveURL(/127\.0\.0\.1:5173\/$|localhost:5173\/$/);
});
