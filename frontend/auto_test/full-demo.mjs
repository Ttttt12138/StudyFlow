import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { familyJourney } from './full-demo-family.mjs';
import { moneyJourney, trustJourney } from './full-demo-money.mjs';

export function configure(h) {
  const { page, context, origin, output, recording, get, say } = h;
  const checks = [];
  h.extraErrors = [];
  h.read = route => get(context, route);
  h.mark = async (name, hold = 6) => {
    console.log('SHOT', name);
    await recording.mark(page, name, hold);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });
  };
  h.check = (name, data = {}) => {
    checks.push({ name, passed: true, ...data });
    writeFileSync(new URL('coverage.json', output), JSON.stringify(checks, null, 2));
    console.log('PASS', name);
  };
  h.open = async (tool, section = '') => {
    await page.goto(`${origin}/?tool=${tool}${section ? '&section=' + encodeURIComponent(section) : ''}`);
    const expand = page.getByRole('button', { name: 'Expand tool', exact: true });
    if (await expand.count()) await expand.click();
  };
  h.close = async () => {
    const close = page.getByRole('button', { name: 'Close tool', exact: true });
    if (await close.count()) await close.click();
  };
  h.ask = async text => { await h.close(); return say(page, text); };
  return {
    async cost() {
      const result = await h.ask('What is the total cost of the full programme at PSU Phuket? Include tuition, housing and living costs, and essential costs.');
      const card = result.cards.find(c => c.type === 'cost');
      assert.ok(card?.estimate?.lines?.length);
      assert.ok(Number(card.estimate.total) > 0);
      await h.mark('single-school-total');
      await page.locator('.price-card').first().getByRole('button', { name: 'Line items', exact: true }).click();
      await h.mark('cost-tuition');
      for (const [index, name] of [[1, 'cost-living'], [2, 'cost-essentials']]) {
        await page.locator('.panel-grid-3 button').nth(index).click();
        await h.mark(name, 4);
      }
      h.check('Single-school full-course estimate with sourced and estimated lines', { total: card.estimate.total });
      await h.close();
    },
    async currencies() {
      for (const currency of ['CNY', 'USD', 'THB']) {
        await page.locator('.currency-switch').getByRole('button', { name: new RegExp(`${currency}$`) }).click();
        await h.mark(`comparison-${currency}`, 4);
      }
      h.check('Four-school comparison and THB/CNY/USD display');
    },
    async planDetails() {
      const original = await h.read('planning/assessment/');
      const food = original.estimate.lines.find(c => c.cost_id === 'food') ?? original.estimate.lines.find(c => c.group === 'living');
      await page.getByRole('button', { name: /^Edit details by hand/ }).click();
      const form = page.locator('form.assessment-edit');
      await form.getByRole('button', { name: 'Adjust a fee', exact: true }).click();
      const row = form.locator('.assessment-item').last();
      await row.locator('select').selectOption(food.cost_id);
      await row.getByLabel('Amount', { exact: true }).fill(String(Number(food.amount) + 100));
      await h.mark('adjust-cost-assumption', 3);
      await form.getByRole('button', { name: 'View my options', exact: true }).click();
      await page.getByRole('region', { name: 'Pre-check result' }).waitFor();
      const adjusted = await h.read('planning/assessment/');
      assert.notEqual(adjusted.estimate.total, original.estimate.total);
      await h.mark('adjusted-total');
      await page.getByRole('button', { name: /^Details and sources/ }).click();
      await h.mark('forecast-and-sources');
      await h.open('funding');
      await page.getByRole('button', { name: /^Edit details by hand/ }).click();
      await form.getByRole('button', { name: 'Remove', exact: true }).last().click();
      await form.getByRole('button', { name: 'View my options', exact: true }).click();
      await page.getByRole('region', { name: 'Pre-check result' }).waitFor();
      assert.equal((await h.read('planning/assessment/')).estimate.total, original.estimate.total);
      h.check('Cost assumptions persist, recalculate totals, expose dated forecast and sources, and can be restored');
    },
    async loanMethods(chooser) {
      await chooser.getByRole('radio', { name: /Custom simulated loan/ }).click();
      await chooser.getByRole('radio', { name: '36 months', exact: true }).click();
      await expect(chooser.locator('tbody tr')).toHaveCount(36);
      await h.mark('loan-custom');
      await chooser.getByRole('radio', { name: /Commercial study loan/ }).click();
      await chooser.getByRole('radio', { name: '60 months', exact: true }).click();
      await chooser.getByRole('radio', { name: /Interest only while studying/ }).check();
      await expect(chooser.locator('tbody tr.is-study')).toHaveCount(42);
      await h.mark('loan-interest-only');
      await chooser.getByRole('radio', { name: 'Monthly principal and interest from the start', exact: true }).check();
      await expect(chooser.locator('tbody tr.is-study')).toHaveCount(0);
      h.check('Both repayment methods and full schedules', { studyMonths: 42, repaymentMonths: 60 });
    },
    async preparation() {
      await h.ask('Remind me tomorrow to submit housing documents.');
      const life = await h.read('planning/life/');
      const task = life.items.find(i => /housing documents/i.test(typeof i.title === 'string' ? i.title : i.title.en));
      assert.ok(task);
      assert.equal(task.due_date, '2027-08-02');
      await h.open('life', task.source_key);
      await h.mark('preparation-reminder');
      const detail = page.locator('.life-detail');
      await detail.getByRole('button', { name: 'Got it', exact: true }).click();
      await expect(detail.getByRole('button', { name: 'Got it', exact: true })).toHaveCount(0);
      await page.reload();
      assert.equal((await h.read('planning/life/')).items.find(i => i.source_key === task.source_key).unread, false);
      await page.locator('.life-detail').getByRole('button', { name: 'Mark completed', exact: true }).click();
      await h.mark('preparation-completed', 3);
      h.check('Live AI reminder, persisted acknowledgement and completion');
      await h.open('funding');
    },
    async afterRepayment() {
      h.check('Loan application, checklist, signing, school payouts and wallet repayment');
      await familyJourney(h);
      await enrollAndBudget(h);
      await moneyJourney(h);
      await creditRepayment(h);
      await trustJourney(h);
      assert.deepEqual(h.extraErrors, []);
    },
  };
}

async function enrollAndBudget(h) {
  const { page } = h;
  assert.equal((await h.read('planning/profile/')).plan.status, 'CONFIRMED');
  await h.ask('I have completed registration at PSU Phuket and arrived on campus. Please confirm my enrollment.');
  const card = page.locator('.plan-card-confirm').filter({ hasText: /enrollment/i }).last();
  await h.mark('enrollment-proposal');
  assert.equal((await h.read('planning/profile/')).plan.status, 'CONFIRMED');
  await card.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await h.read('planning/profile/')).plan.status, 'ENROLLED');
  await h.mark('enrolled');
  h.check('Explicit enrollment with user confirmation; date alone did not enroll');
  await h.open('life');
  await page.locator('.life-summary').getByRole('button', { name: 'Edit budget' }).click();
  await page.locator('.life-summary form input').fill('6000');
  await page.locator('.life-summary form').getByRole('button', { name: 'Save', exact: true }).click();
  await h.mark('monthly-budget');
  assert.equal((await h.read('planning/life/')).budget.budget, '6000.00');
  await h.ask('Record that I spent 120 THB on lunch today.');
  let life = await h.read('planning/life/');
  assert.equal(life.budget.spent, '120.00');
  assert.equal(life.budget.remaining, '5880.00');
  await h.open('life');
  await page.locator('.life-spending').scrollIntoViewIfNeeded();
  await h.mark('expense-recorded');
  await page.getByRole('button', { name: 'Undo entry' }).click();
  await expect(page.getByRole('button', { name: 'Undo entry' })).toHaveCount(0);
  life = await h.read('planning/life/');
  assert.equal(life.budget.remaining, '6000.00');
  await h.mark('expense-undone', 3);
  h.check('Budget edit, live AI expense, categories and undo', { remaining: life.budget.remaining });
}

async function creditRepayment(h) {
  const line = await h.read('planning/credit/');
  const life = await h.read('planning/life/');
  const bill = life.items.find(i => i.kind === 'bill' && !i.done && !i.paid_by_loan && Number(i.amount) > 0 && Number(i.amount) < Number(line.available));
  assert.ok(bill, 'A bill within the fixed credit line');
  await h.open('life', bill.source_key);
  await h.page.getByRole('button', { name: 'Pay with credit', exact: true }).click();
  await h.mark('credit-used');
  const used = await h.read('planning/credit/');
  assert.equal(used.used, bill.amount);
  const charge = used.charges.find(c => c.bill_id === bill.source_key.split(':')[1]);
  // Paying credit back takes THB from the wallet, so make sure the wallet can cover it first.
  const thb = async () => Number((await h.read('demo/wallets/balances/')).balances.find(b => b.currency === 'THB')?.available_balance ?? 0);
  if (await thb() < Number(charge.amount)) await h.post(h.context, 'demo/wallets/top-up/', { currency: 'THB', amount: charge.amount });
  const start = await thb();
  await h.open('life', `credit:${charge.id}`);
  await h.mark('credit-repayment');
  await h.page.getByRole('button', { name: 'Repay from wallet', exact: true }).click();
  const dialog = h.page.getByRole('dialog', { name: 'Review and confirm' });
  await dialog.getByLabel('Password').waitFor();
  await h.mark('credit-password', 4);
  await dialog.getByLabel('Password').fill(process.env.SHORT_TEST_PASSWORD);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await h.mark('credit-restored', 4);
  assert.equal((await h.read('planning/credit/')).used, '0.00');
  assert.ok(Math.abs(start - await thb() - Number(charge.amount)) < 0.001);
  const record = await h.read('credit/profile/');
  assert.ok(record.evidence.some(e => e.source === 'credit_charge' && e.id === charge.id && e.status === 'ON_TIME'));
  h.check('Fixed demo credit use, wallet repayment with password and an on-time record', { amount: charge.amount });
}
