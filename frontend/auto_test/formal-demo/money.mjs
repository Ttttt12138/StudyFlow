import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { openOpsItem } from '../../tests/operations-support.mjs';
import { balance, advance } from './payments.mjs';

async function confirm(h, s, card, wrong = false) {
  await card.getByRole('button', { name: 'Review and confirm', exact: true }).click();
  const dialog = s.page.getByRole('dialog', { name: 'Review and confirm' });
  if (wrong) {
    const before = await balance(h, s, 'CNY');
    await dialog.getByLabel('Password', { exact: true }).fill('incorrect-demo-password');
    await dialog.getByRole('button', { name: 'Authorize and confirm', exact: true }).click();
    await dialog.getByText('That password was not accepted.', { exact: false }).waitFor();
    assert.equal(await balance(h, s, 'CNY'), before);
    await h.mark(s, 'wrong-password-blocked', dialog);
  }
  await dialog.getByLabel('Password', { exact: true }).fill(h.password);
  await dialog.getByRole('button', { name: 'Authorize and confirm', exact: true }).click();
  return dialog;
}

export async function moneyJourney(h, s) {
  const page = s.page;
  await h.api(s, 'demo/wallets/top-up/', { currency: 'CNY', amount: '30000.00' });
  await h.open(s, 'wallet', 'balances'); await h.mark(s, 'currency-balances');
  let turn = await h.ask(s, 'Convert 500 CNY from my wallet into THB. Compare the conversion quotes and prepare the best quote for my confirmation.', 'exchange-proposal');
  assert.ok(turn.steps.some(step => step.tool === 'convert_balance'));
  assert.equal(await balance(h, s, 'CNY'), 30000);
  let card = page.locator('.plan-card-confirm').last();
  await h.mark(s, 'exchange-review', card);
  await confirm(h, s, card, true);
  await card.getByText('Confirmed', { exact: true }).waitFor();
  await h.mark(s, 'exchange-confirmed', card);
  assert.equal(await balance(h, s, 'CNY'), 29500);
  h.check('Live quote comparison and exchange proposal, wrong password denied, authorized CNY 500 debit');
  turn = await h.ask(s, 'Send 1,000 CNY to my own THB wallet for living costs. Compare routes, fees and arrival times, then prepare the transfer for my confirmation.', 'remittance-proposal');
  assert.ok(turn.steps.some(step => step.tool === 'submit_remittance_order'));
  assert.equal(await balance(h, s, 'CNY'), 29500);
  card = page.locator('.plan-card-confirm').last();
  await h.mark(s, 'remittance-review', card);
  await confirm(h, s, card);
  await card.getByText('Confirmed', { exact: true }).waitFor();
  assert.equal(await balance(h, s, 'CNY'), 28500);
  const orders = (await h.api(s, 'remittance-orders/')).results;
  const order = orders.find(o => o.send_amount === '1000.00');
  assert.ok(order && order.status === 'SUBMITTED');
  await h.open(s, 'wallet', 'history'); await h.mark(s, 'remittance-history');
  await advance(h, s, order.expected_latest, 'remittance-arrival');
  assert.equal((await h.api(s, `remittance-orders/${order.id}/`)).status, 'DELIVERED');
  await h.open(s, 'wallet', 'history'); await h.mark(s, 'remittance-delivered');
  h.check('Live remittance comparison, explicit submission, order and delivery on final delivery-window day', { order: order.id, delivery: order.expected_latest });
  await operationsJourney(h, s);
}

async function operationsJourney(h, s) {
  const op = await h.login('operator'), approver = await h.login('approver');
  await h.api(s, 'operations/queue/', undefined, [403]);
  const payee = await h.api(s, 'beneficiaries/', { name: 'Campus Housing Office', destination_label: 'SIMULATED-THB-HOUSING' });
  await op.page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await op.page.getByRole('navigation').getByRole('button', { name: /^Work queue/ }).click();
  await op.page.getByLabel('Student', { exact: true }).fill('film-student');
  let detail = await openOpsItem(op.page, 'payee', payee.name);
  await h.mark(op, 'payee-review', detail);
  await detail.getByRole('button', { name: 'Verify payee', exact: true }).click();
  await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await h.ask(s, 'Send 15,000 CNY to the verified Campus Housing Office in THB for housing. Compare routes and prepare it for my confirmation.', 'large-transfer');
  const card = s.page.locator('.plan-card-confirm').last();
  const before = await balance(h, s, 'CNY');
  const dialog = await confirm(h, s, card);
  await expect(dialog).toContainText('above your limit');
  assert.equal(await balance(h, s, 'CNY'), before);
  await h.mark(s, 'large-transfer-blocked', dialog);
  await dialog.locator('textarea').fill('Study housing payment: please verify payee and purpose.');
  await dialog.getByRole('button', { name: /Request.*approval/i }).click();
  await expect(dialog).toHaveCount(0);
  await h.mark(s, 'approval-requested', card);
  const approval = (await h.api(s, 'approvals/')).results.find(a => a.status === 'PENDING' && a.amount === '15000.00');
  assert.ok(approval);
  await op.page.getByRole('button', { name: 'Refresh', exact: true }).click();
  detail = await openOpsItem(op.page, 'approval');
  await expect(detail).toContainText('You verified this payee, so another operator must decide.');
  assert.equal(await detail.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
  await h.mark(op, 'separation-of-duties', detail);
  await approver.page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await h.mark(approver, 'operations-overview');
  await approver.page.getByRole('navigation').getByRole('button', { name: /^Work queue/ }).click();
  await approver.page.getByLabel('Student', { exact: true }).fill('film-student');
  detail = await openOpsItem(approver.page, 'approval');
  await expect(detail).toContainText('15,000');
  await detail.getByLabel('Decision note (shown to the student)').fill('Payee, housing purpose and amount checked.');
  await h.mark(approver, 'approval-details', detail);
  await detail.getByRole('button', { name: 'Approve', exact: true }).click();
  await h.mark(approver, 'approval-confirmation', detail, 2);
  await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await approver.page.getByText('Approved. film-student can now submit with their password.', { exact: true }).waitFor();
  assert.equal(await balance(h, s, 'CNY'), before, 'Approval alone moves no money');
  await approver.page.getByRole('navigation').getByRole('button', { name: 'Recent records', exact: true }).click();
  await h.mark(approver, 'approval-record', approver.page.locator('#ops-decisions'));
  await confirm(h, s, card);
  await card.getByText('Confirmed', { exact: true }).waitFor();
  assert.equal(await balance(h, s, 'CNY'), before - 15000);
  assert.equal((await h.api(s, 'approvals/')).results.find(a => a.id === approval.id).status, 'USED');
  await h.mark(s, 'approved-transfer-submitted', card);
  h.save('approval-records.json', await h.api(s, 'approvals/'));
  h.check('Live over-limit transfer, student denial, operator payee verification, separation of duties, independent approval, no debit until password and single-use approval', { amount: '15000.00', currency: 'CNY', approval: approval.id });
}
