import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function balance(h, s, currency) {
  return Number((await h.api(s, 'demo/wallets/balances/')).balances.find(row => row.currency === currency)?.balance ?? 0);
}

export async function advance(h, s, date, name) {
  await h.open(s, 'life');
  await s.page.getByRole('button', { name: /^Demo date / }).click();
  await s.page.getByLabel('Demo date', { exact: true }).fill(date);
  await h.mark(s, name + '-clock', s.page.getByLabel('Demo date', { exact: true }), 2);
  await s.page.getByRole('button', { name: 'Advance demo date', exact: true }).click();
  await expect.poll(async () => (await h.api(s, 'planning/life/')).today).toBe(date);
}

export async function paymentJourney(h, s) {
  const page = s.page;
  const life = await h.api(s, 'planning/life/');
  const due = new Date(life.today + 'T12:00:00Z'); due.setUTCDate(due.getUTCDate() + 2);
  const date = due.toISOString().slice(0, 10);
  await h.ask(s, `Remind me on ${date} to prepare my passport copies.`, 'reminder-created');
  const tasks = await h.api(s, 'planning/life/');
  const task = tasks.items.find(item => JSON.stringify(item.title).toLowerCase().includes('passport copies'));
  assert.ok(task && task.due_date === date);
  await h.open(s, 'life'); await h.mark(s, 'todo-overview');
  await page.locator('.life-item').filter({ hasText: /passport copies/i }).getByRole('button').click();
  const detail = page.locator('.life-detail');
  const currentTask = async () => (await h.api(s, 'planning/life/')).items.find(item => item.source_key === task.source_key);
  if (await detail.getByRole('button', { name: 'Got it', exact: true }).count()) {
    await detail.getByRole('button', { name: 'Got it', exact: true }).click();
    await expect.poll(async () => (await currentTask()).unread).toBe(false);
  }
  await detail.getByRole('button', { name: 'Mark completed', exact: true }).click();
  await expect.poll(async () => (await currentTask()).done).toBe(true);
  await h.mark(s, 'reminder-completed', detail);
  await detail.getByRole('button', { name: 'Undo completion', exact: true }).click();
  await expect.poll(async () => (await currentTask()).done).toBe(false);
  await h.mark(s, 'reminder-reopened', detail, 2);
  h.check('Task acknowledgement, persisted completion and undo completion');
  await h.open(s, 'wallet', 'pay');
  const data = await h.api(s, 'planning/wallet-bills/');
  const bill = data.bills.find(b => b.status === 'DUE' && !b.paid_by_loan && b.kind === 'tuition' && b.group && Number(b.amount) < 50000);
  assert.ok(bill, 'A partly loan-covered tuition bill with a self-paid remainder');
  const name = typeof bill.label === 'string' ? bill.label : bill.label.en;
  const row = page.locator('.bill-rows li').filter({ has: page.getByText(name, { exact: true }) }).first();
  await h.mark(s, 'partial-tuition', row);
  assert.equal(data.school_payee.verified, true);
  await row.getByRole('button', { name: 'Top up', exact: true }).click();
  await h.mark(s, 'tuition-topup', row);
  await row.getByRole('button', { name: /^Top up THB/ }).click();
  await row.getByRole('button', { name: 'Pay from wallet', exact: true }).waitFor();
  const before = await balance(h, s, 'THB');
  await row.getByRole('button', { name: 'Pay from wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review and confirm' });
  await h.mark(s, 'tuition-authorization', dialog);
  await dialog.getByLabel('Password').fill(h.password);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await h.mark(s, 'tuition-paid', page.locator('.plan-bills-pay').first());
  assert.equal((await h.api(s, 'planning/wallet-bills/')).bills.find(b => b.id === bill.id).status, 'PAID');
  assert.ok(Math.abs(before - await balance(h, s, 'THB') - Number(bill.amount)) < .001);
  const loanBill = data.bills.find(b => b.paid_by_loan);
  const denied = await h.api(s, `planning/bills/${loanBill.id}/pay-from-wallet/`, {}, [400, 403]);
  h.check('Persisted live-AI reminder and partially covered tuition shown once, wallet top-up and authorized payment', { bill: bill.amount, loanBillDuplicateDenied: denied });
}

export async function repaymentJourney(h, s) {
  let data = await h.api(s, 'planning/assessment/');
  const installment = data.lifecycle.accounts[0].installments[0];
  const life = await h.api(s, 'planning/life/');
  await advance(h, s, [life.today, installment.due_on].sort().at(-1), 'repayment');
  await h.api(s, 'demo/wallets/top-up/', { currency: 'THB', amount: '10000.00' });
  await h.open(s, 'funding');
  await h.mark(s, 'repayment-due');
  await s.page.getByRole('button', { name: 'Confirm repayment', exact: true }).click();
  const review = s.page.getByRole('dialog', { name: 'Confirm repayment', exact: true });
  await h.mark(s, 'repayment-review', review);
  await review.getByRole('button', { name: 'Confirm repayment', exact: true }).click();
  const dialog = s.page.getByRole('dialog', { name: 'Review and confirm', exact: true });
  await h.mark(s, 'repayment-authorization', dialog, 2);
  await dialog.getByLabel('Password').fill(h.password);
  const before = await balance(h, s, 'THB');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => (await h.api(s, 'planning/assessment/')).lifecycle.accounts[0].installments[0].status).toBe('PAID');
  await h.mark(s, 'repayment-paid');
  assert.ok(Math.abs(before - await balance(h, s, 'THB') - Number(installment.amount)) < .001);
  data = await h.api(s, 'planning/assessment/'); h.save('loan-after-repayment.json', data);
  await h.open(s, 'wallet', 'history');
  await s.page.getByRole('button', { name: 'Ledger', exact: true }).click();
  await h.mark(s, 'final-ledger');
  // Every page, so the saved operation log covers the whole journey, not only the newest 50 events.
  const audit = await h.api(s, 'audit/');
  for (let page = 2; audit.results.length < audit.count; page++)
    audit.results.push(...(await h.api(s, `audit/?page=${page}`)).results);
  audit.next = null; h.save('financial-audit.json', audit);
  h.check('Real simulated loan installment repaid with password and exact wallet debit', { amount: installment.amount });
}
