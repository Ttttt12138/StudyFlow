import { test, expect } from '@playwright/test';
test('guided demo follows all eight stops without API writes', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const errors = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => { calls.push(route.request().url()); return route.abort(); });
  await page.goto('/?tour=1');
  const bar = page.getByRole('region', { name: 'Guided demo' });
  const stops = [[null, 'plan'], ['School comparison', 'plan'], ['My plan', 'plan'], ['My plan', 'prepare'],
    ['To-dos and bills', 'prepare'], ['Wallet & payments', 'prepare'], ['Wallet & payments', 'prepare'], ['My plan', 'prepare']];
  for (const [index, [tool, stage]] of stops.entries()) {
    await expect(bar).toContainText(`Step ${index + 1} of 8`);
    if (tool) await expect(page.locator('#workspace-tool-title')).toHaveText(tool);
    expect(new URL(page.url()).searchParams.get('stage') ?? 'plan').toBe(stage);
    await bar.getByRole('button', { name: index === 7 ? 'Finish' : 'Next', exact: true }).click();
  }
  await expect(bar).toHaveCount(0);
  expect(errors).toEqual([]); expect(calls).toEqual([]);
});
