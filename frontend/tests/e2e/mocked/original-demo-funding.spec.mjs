import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { screenshot } from '../../support.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173';

async function openDemo(page) {
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: false, username: null, csrf_token: 'mock-csrf' } }));
  await page.goto(`${base}/?legacy=1`);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to expenses' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByRole('heading', { name: 'Compare your budget.' }).waitFor();
}

test.describe('original demo: funding and simulated application', () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  test('budget gap → suggested funding plan → loan quote → simulated decision → journey summary', async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v2/**', route => { apiCalls++; return route.abort(); });
    await openDemo(page);
    const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: false });
    assert.equal(await nav('Simulated application').isDisabled(), true);

    // Budget: the standard scenario is preselected; continue to funding.
    await page.getByRole('button', { name: 'Selected for funding' }).waitFor();
    await page.getByRole('button', { name: 'Continue to funding' }).click();
    await page.getByRole('heading', { name: 'Cover the gap.' }).waitFor();
    assert.equal(await page.locator('.flow-gap-amount').innerText(), 'USD 3,450');
    // With nothing else entered, a loan for the whole gap is the only plan; it still needs a review.
    await page.getByText('USD 3,500 from Demo Credit Union').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continue to application' }).isDisabled(), true);
    // Choosing another lender prices the same tier with that lender.
    await page.getByRole('radio', { name: /Demo Bank/ }).check();
    await page.getByText('USD 3,500 from Demo Bank').waitFor();

    // Suggested plan: family 2,000 on time, the rest from the cheapest loan tier that covers 1,450.
    await page.getByRole('button', { name: 'Use the suggested plan' }).click();
    assert.equal(await page.getByLabel('Amount from Family top-up').inputValue(), '2000');
    await page.getByText('The gap is covered, with a loan for the rest.').waitFor();
    await page.getByText('USD 1,500 from Demo Credit Union').waitFor();
    await page.getByText(/Not certain yet: Family top-up/).waitFor();
    // Money that arrives after tuition is due does not reduce the loan.
    await page.getByLabel('Amount from Partial scholarship (applied)').fill('1000');
    await page.getByText('Arrives too late (not counted)').waitFor();
    await page.getByText('USD 1,500 from Demo Credit Union').waitFor();
    await page.getByLabel('Amount from Family top-up').fill('2500');
    await page.getByText('More than this source can give (at most USD 2,000).').waitFor();
    await page.getByRole('button', { name: 'Use the suggested plan' }).click();
    await page.getByLabel('I reviewed this plan.').check();
    await page.screenshot({ path: screenshot('original-demo-funding.png'), fullPage: true });
    await page.getByRole('button', { name: 'Continue to application' }).click();

    // Simulated application against the chosen quote.
    await page.getByRole('heading', { name: 'Simulated application.' }).waitFor();
    await page.getByRole('heading', { name: 'Quote from Demo Credit Union' }).waitFor();
    await page.getByText('USD 129.72', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Submit simulated application' }).isDisabled(), true);
    await page.getByLabel('Monthly income (USD)').fill('800');
    await page.getByLabel('Monthly living costs (USD)').fill('600');
    await page.getByLabel('Other monthly repayments (USD)').fill('0');
    await page.getByLabel('I understand this is a simulated application.').check();
    await page.getByRole('button', { name: 'Submit simulated application' }).click();
    await page.getByRole('heading', { name: 'Not affordable' }).waitFor();
    await page.getByText('Simulated application not affordable; adjust the plan and try again.').waitFor();
    await page.getByLabel('Monthly income (USD)').fill('900');
    assert.equal(await page.getByRole('heading', { name: 'Not affordable' }).count(), 0);
    await page.getByRole('button', { name: 'Submit simulated application' }).click();
    await page.getByRole('heading', { name: 'Approved (simulated)' }).waitFor();
    const summary = page.locator('.flow-summary li');
    assert.deepEqual(await summary.allInnerTexts(), [
      'Admission details confirmed.', 'Expenses completed.',
      'Budget compared: “Standard arrival” leaves a gap of USD 3,450.',
      'Funding planned: USD 2,000 from money that arrives in time. A loan of USD 1,500 from Demo Credit Union covers the rest.',
      'Simulated application approved.',
    ]);
    await page.screenshot({ path: screenshot('original-demo-application.png'), fullPage: true });

    // Going back and changing the plan clears the confirmation and the decision.
    await page.getByRole('button', { name: 'Back to funding' }).click();
    await page.getByRole('radio', { name: /Demo Student Lender/ }).check();
    assert.equal(await page.getByLabel('I reviewed this plan.').isChecked(), false);
    assert.equal(await nav('Simulated application').isDisabled(), true);

    await page.getByRole('button', { name: '中文' }).click();
    await page.getByRole('heading', { name: '填补缺口。' }).waitFor();
    await page.getByRole('button', { name: 'English' }).click();
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });

  test('a scenario that money arriving in time can cover finishes without a loan', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openDemo(page);
    await page.locator('.scenario-card').filter({ hasText: 'Lower living estimate' }).getByRole('button', { name: 'Plan funding for this scenario' }).click();
    await page.getByRole('button', { name: 'Continue to funding' }).click();
    assert.equal(await page.locator('.flow-gap-amount').innerText(), 'USD 1,950');
    await page.getByLabel('Amount from Family top-up').fill('2000');
    await page.getByText('No loan is needed: money that arrives in time covers the gap.').waitFor();
    await page.getByText('The gap is covered without a loan.').waitFor();
    await page.getByLabel('I reviewed this plan.').check();
    await page.getByRole('button', { name: 'Finish without a loan' }).click();
    await page.getByText('Your plan covers the gap without a loan, so there is nothing to apply for.').waitFor();
    await page.getByText('Budget compared: “Lower living estimate” leaves a gap of USD 1,950.').waitFor();
    await page.getByRole('button', { name: 'Start the demo again' }).click();
    await page.getByRole('heading', { name: 'Start with the facts.' }).waitFor();
    assert.deepEqual(errors, []);
  });

  test('funding and application fit a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);
    await page.getByRole('button', { name: 'Continue to funding' }).click();
    await page.getByRole('button', { name: 'Use the suggested plan' }).click();
    await page.getByLabel('I reviewed this plan.').check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Continue to application' }).click();
    await page.getByRole('heading', { name: 'Simulated application.' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot('original-demo-application-mobile.png'), fullPage: true });
  });
});
