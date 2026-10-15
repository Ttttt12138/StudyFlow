import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// inputs.loan.annual_rate is the custom-loan default; a fixed-rate product is priced at its own rate.
const priced = data => ({ ...data.inputs.loan,
  annual_rate: data.products.find(p => p.key === data.inputs.loan.product)?.annual_rate ?? data.inputs.loan.annual_rate });

export async function planningJourney(h, s) {
  const page = s.page, advice = () => page.locator('.loan-advice-card').last();
  const read = () => h.api(s, 'planning/assessment/');
  await page.locator('.plan-composer textarea').waitFor();
  await h.mark(s, 'opening');
  let turn = await h.ask(s, 'What is the full programme cost of studying at PSU Phuket, including tuition and living expenses?', 'school-cost');
  assert.ok(turn.cards.some(c => c.type === 'cost'));
  await h.mark(s, 'cost-card', page.locator('.price-card').last());
  await page.locator('.price-card').last().getByRole('button', { name: 'Line items', exact: true }).click();
  await h.mark(s, 'cost-sources');
  for (const [index, label] of [[1, 'cost-living'], [2, 'cost-essentials']]) {
    await page.locator('.panel-grid-3 button').nth(index).click();
    await h.mark(s, label);
  }
  turn = await h.ask(s, 'Compare the full-course costs of PSU Phuket, Chulalongkorn, Mahidol and Thammasat.', 'school-comparison');
  assert.ok(turn.cards.some(c => c.type === 'comparison' && c.schools.length === 4));
  await h.mark(s, 'comparison-card', page.locator('.compare-grid').last());
  for (const currency of ['CNY', 'USD', 'THB']) {
    await page.getByRole('group', { name: 'Show prices in', exact: true }).getByRole('button', { name: new RegExp(currency + '$') }).first().click();
    await h.mark(s, 'comparison-' + currency.toLowerCase(), page.locator('.compare-grid').last(), 2);
  }
  h.check('Live sourced full-course costs, four-school comparison and THB/CNY/USD display');
  turn = await h.ask(s, "What is PSU Phuket's current QS ranking?", 'missing-ranking');
  assert.match(turn.final_answer, /not|don.t|haven.t|isn.t|unavailable|no .*rank/i);
  assert.ok(!turn.steps.some(step => step.tool === 'get_school_profile'));
  h.check('Unavailable ranking disclosed without inventing a ranking');
  await h.ask(s, 'What food and campus facilities are near PSU Phuket?', 'school-profile');
  await h.ask(s, 'Choose PSU Phuket for its standard programme duration.', 'school-chosen');
  await expect(advice()).toContainText('how much you would like to borrow');
  assert.equal((await read()).lifecycle.applications.length, 0);
  await h.ask(s, 'I would like to borrow 48,000 THB.', 'loan-recommended');
  const first = await read();
  assert.equal(first.inputs.loan.principal, '48000.00');
  await h.mark(s, 'loan-card', advice());
  await advice().getByText('Compare other plans', { exact: true }).click();
  await h.mark(s, 'loan-alternatives', advice().locator('details'));
  await h.open(s, 'funding');
  await h.mark(s, 'manual-loan-controls', page.locator('.assessment-panel'));
  await h.ask(s, 'The monthly payment is too high. Can you lower it?', 'lower-monthly');
  const lower = await read();
  assert.ok(Number(lower.inputs.loan.months) > Number(first.inputs.loan.months));
  await h.mark(s, 'monthly-change', advice().locator('.loan-advice-change'));
  await h.ask(s, 'Use the commercial study loan with interest-only payments while studying.', 'interest-only');
  const interestOnly = await read();
  assert.equal(interestOnly.inputs.loan.method, 'interest_only');
  await h.mark(s, 'interest-only-card', advice());
  await h.ask(s, 'I prefer principal and interest payments from the start. I would like to pay less total interest.', 'lower-interest');
  const cheaper = await read();
  assert.equal(cheaper.inputs.loan.method, 'amortized');
  assert.ok(Number(cheaper.inputs.loan.months) < Number(lower.inputs.loan.months));
  await h.mark(s, 'interest-change', advice().locator('.loan-advice-change'));
  await h.ask(s, "I'd like to borrow less.", 'ask-reduced-amount');
  await expect(advice()).toContainText('how much you would like to borrow');
  await h.ask(s, '30,000 THB.', 'reduced-amount');
  const reduced = await read();
  assert.equal(reduced.inputs.loan.principal, '30000.00');
  assert.equal(reduced.lifecycle.applications.length, 0);
  await h.mark(s, 'reduced-card', advice());
  h.check('Loan recommendation, actual monthly/interest tradeoffs, interest-only phases and reduced principal', {
    initial: priced(first), lowerMonthly: priced(lower), final: priced(reduced) });
  await h.ask(s, 'Not interested in a loan for now.', 'pause-loan');
  await expect(advice()).toContainText('Loan recommendations paused');
  const unrelated = await h.ask(s, 'Tell me about the food near campus.', 'paused-school-question');
  assert.ok(!unrelated.steps.some(step => step.tool === 'simulate_loan'));
  await h.ask(s, 'Resume loan recommendations.', 'resume-loan');
  await expect(advice().getByRole('button', { name: 'Apply with this plan', exact: true })).toBeVisible();
  const historical = page.locator('.loan-advice-card').nth(1);
  assert.equal(await historical.getByRole('button', { name: 'Apply with this plan', exact: true }).count(), 0);
  const stale = await h.api(s, 'planning/plan/confirm/', { expected_version: first.version,
    plan_version: first.plan_version, quote_id: first.quotes[0].id }, [400, 409]);
  assert.equal((await read()).lifecycle.applications.length, 0);
  h.check('Stale quote submission rejected without creating an application', { rejection: stale });
  h.check('Pause, unrelated question, explicit resume and inactive historical recommendation');
  await h.ask(s, 'I would like to apply with this plan. Show me what I need to review.', 'application-intent');
  assert.equal((await read()).lifecycle.applications.length, 0);
  const review = page.getByRole('dialog', { name: 'Review and submit application', exact: true });
  if (!await review.isVisible()) await advice().getByRole('button', { name: 'Apply with this plan', exact: true }).click();
  await expect(review).toContainText('30,000');
  await h.mark(s, 'application-review', review);
  await review.getByRole('button', { name: 'Confirm plan and apply', exact: true }).click();
  await expect(review).toHaveCount(0);
  let data = await read();
  assert.equal(data.plan.status, 'CONFIRMED');
  assert.equal(data.lifecycle.applications.length, 1);
  assert.equal(data.loan_stage.signed, false);
  await h.mark(s, 'application-submitted', page.locator('.loan-stage'));
  const notice = page.getByRole('checkbox', { name: /Simulated admission notice/ });
  await expect(notice).toBeChecked(); await expect(notice).toBeDisabled();
  h.check('Explicit application confirmation, automatic simulated notice, no automatic signing');
  await h.open(s, 'wallet', 'pay');
  await h.mark(s, 'unsigned-bill-coverage', page.locator('.plan-bills-loan-notice'));
  assert.ok((await h.api(s, 'planning/wallet-bills/')).bills.some(b => b.loan_pending));
  await h.open(s, 'funding');
  for (const doc of data.loan_stage.documents.filter(d => !d.auto && !d.done)) {
    const checkbox = page.getByRole('checkbox', { name: doc.title.en, exact: false });
    await checkbox.click();
    await expect.poll(async () => (await read()).loan_stage.documents.find(d => d.id === doc.id).done).toBe(true);
    await expect(checkbox).toBeChecked();
  }
  await h.mark(s, 'documents-ready', page.locator('.loan-stage-docs'));
  await page.getByRole('button', { name: 'Sign the loan', exact: true }).click();
  const signing = page.getByRole('dialog', { name: 'Sign the simulated loan', exact: true });
  await h.mark(s, 'signing-review', signing);
  await signing.getByRole('button', { name: 'Sign the loan', exact: true }).click();
  await expect(page.locator('.loan-stage-payouts')).toBeVisible();
  data = await read();
  assert.equal(data.loan_stage.signed, true);
  assert.equal(data.lifecycle.accounts.length, 1);
  assert.ok(data.loan_stage.payouts.length > 0);
  await h.mark(s, 'school-payout-schedule', page.locator('.loan-stage-payouts'));
  h.save('loan-after-signing.json', data);
  h.check('Document declarations, explicit signing and verified-school-directed payout schedule');
}
