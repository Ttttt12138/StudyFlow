// Real API and calculation, isolated database, deterministic agent; no real funds.
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

for (const lang of ['en', 'zh']) {
  test(`loan adviser recommends, addresses concerns and opens explicit application review (${lang})`, async ({ browser }) => {
    const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
    const username = `loan-advice-${randomUUID()}`, password = randomUUID();
    execFileSync(python, ['manage.py', 'shell', '-c',
      'import os; from django.contrib.auth import get_user_model; get_user_model().objects.create_user(os.environ["UAT_USER"],password=os.environ["UAT_PASS"])'],
    { cwd: backend, env: { ...process.env, UAT_USER: username, UAT_PASS: password }, stdio: 'pipe' });
    const context = await browser.newContext({ viewport: lang === 'zh' ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    await context.addInitScript(language => localStorage.setItem('studyflow.lang', language), lang);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const get = async route => (await (await context.request.get(`${origin}/api/v2/${route}`)).json()).data;
    const latest = () => page.locator('.loan-advice-card').last();
    const say = async text => {
      await page.locator('.plan-composer textarea').fill(text);
      await page.locator('.plan-composer button[type="submit"]').click();
      await expect(page.locator('.plan-bubble-user').last()).toContainText(text);
      await expect(page.locator('.plan-thinking')).toHaveCount(0);
      await expect(page.locator('.plan-composer textarea')).toBeEnabled();
    };
    try {
      await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + '/')}`);
      await page.getByLabel('Username').fill(username); await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page.locator('.plan-composer textarea')).toBeEnabled();
      await say(lang === 'zh' ? '就选普吉校区' : 'Choose PSU Phuket');
      await expect(latest()).toContainText(lang === 'zh' ? '告诉我想借多少' : 'how much you would like to borrow');
      await say('48000 THB');
      await expect(latest().getByRole('button', { name: lang === 'zh' ? '按此方案申请' : 'Apply with this plan' })).toBeVisible();
      const first = await get('planning/assessment/');
      assert.equal(first.inputs.loan.product, 'commercial_student_demo');
      assert.equal(first.inputs.loan.principal, '48000.00');
      await latest().getByRole('button', { name: lang === 'zh' ? '月供太高了' : 'Monthly payment too high' }).click();
      await expect(page.locator('.plan-thinking')).toHaveCount(0);
      await expect.poll(async () => (await get('planning/assessment/')).inputs.loan.months).toBe(60);
      await expect(latest()).toContainText(lang === 'zh' ? '与上一方案相比' : 'Compared with the previous plan');
      await latest().getByRole('button', { name: lang === 'zh' ? '不想多付利息' : "I'd like to pay less interest" }).click();
      await expect.poll(async () => (await get('planning/assessment/')).inputs.loan.months).toBe(24);
      await expect(page.locator('.plan-composer textarea')).toBeEnabled();
      await latest().getByRole('button', { name: lang === 'zh' ? '不想借这么多' : "I'd like to borrow less" }).click();
      await expect(latest()).toContainText(lang === 'zh' ? '告诉我想借多少' : 'how much you would like to borrow');
      await expect(page.locator('.plan-composer textarea')).toBeEnabled();
      await say('30000 THB');
      const reduced = await get('planning/assessment/');
      assert.equal(reduced.inputs.loan.principal, '30000.00');
      assert.equal(reduced.inputs.loan.months, 24);
      assert.equal(reduced.lifecycle.applications.length, 0);
      await latest().scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshot(`loan-advice-${lang}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await latest().getByRole('button', { name: lang === 'zh' ? '按此方案申请' : 'Apply with this plan' }).click();
      const dialog = page.getByRole('dialog', { name: lang === 'zh' ? '核对并提交贷款申请' : 'Review and submit application', exact: true });
      await expect(dialog).toContainText(lang === 'zh' ? '30,000' : '30,000');
      assert.equal((await get('planning/assessment/')).lifecycle.applications.length, 0);
      await page.screenshot({ path: screenshot(`loan-advice-review-${lang}.png`) });
      await dialog.getByRole('button', { name: lang === 'zh' ? '确认方案并提交申请' : 'Confirm plan and apply', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () => (await get('planning/assessment/')).plan.status).toBe('CONFIRMED');
      assert.equal((await get('planning/assessment/')).lifecycle.applications.length, 1);
      assert.equal((await get('planning/assessment/')).loan_stage.signed, false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
