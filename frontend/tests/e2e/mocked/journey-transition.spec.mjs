import { test, expect } from '@playwright/test';
import { screenshot } from '../../support.mjs';

test('submitted application guidance fits both languages at desktop and phone widths', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?plan=preview&stage=prepare');
    for (const lang of ['English', '中文']) {
      await page.getByRole('button', { name: lang, exact: true }).click();
      await expect(page.locator('.workspace-stage')).toHaveText(lang === 'English' ? 'Application submitted' : '已提交申请');
      const guide = page.locator('#plan-journey-guide');
      await expect(guide).toBeAttached();
      await expect(guide).toContainText(lang === 'English' ? 'To-dos and bills' : '待办与账单');
      await expect(guide.getByRole('button', { name: /Registration completed|确认入学/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: screenshot(`simplified-${width}-${lang === 'English' ? 'en' : 'zh'}.png`) });
    }
  }
});
