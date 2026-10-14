import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { recordedRole } from './full-demo-family.mjs';

const money = async (h, currency) => Number((await h.read('demo/wallets/balances/')).balances.find(b => b.currency === currency)?.balance ?? 0);

async function confirmMoney(h, card, wrong = false) {
  await card.getByRole('button', { name: 'Review and confirm', exact: true }).click();
  const dialog = h.page.getByRole('dialog', { name: 'Review and confirm' });
  if (wrong) {
    await dialog.getByLabel('Password', { exact: true }).fill('deliberately-wrong-demo-password');
    await dialog.getByRole('button', { name: 'Authorize and confirm' }).click();
    await dialog.getByText('That password was not accepted.', { exact: false }).waitFor();
    await h.mark('wrong-password-refused');
  }
  await dialog.getByLabel('Password', { exact: true }).fill(process.env.SHORT_TEST_PASSWORD);
  await h.mark('money-password-confirm', 3);
  await dialog.getByRole('button', { name: 'Authorize and confirm' }).click();
  return dialog;
}

export async function moneyJourney(h) {
  await h.post(h.context, 'demo/wallets/top-up/', { currency: 'CNY', amount: '30000.00' });
  await h.open('wallet', 'balances');
  await h.mark('multicurrency-wallet');
  const before = await money(h, 'CNY');
  const converted = await h.ask('Convert 500 CNY from my wallet into THB. Compare the conversion quotes and prepare the best quote for my confirmation.');
  assert.ok(converted.steps.some(s => s.tool === 'convert_balance'));
  assert.equal(await money(h, 'CNY'), before);
  let card = h.page.locator('.plan-card-confirm').filter({ hasText: /Convert/ }).last();
  await h.mark('conversion-proposal');
  await confirmMoney(h, card, true);
  await card.getByText('Confirmed', { exact: true }).waitFor();
  assert.equal(await money(h, 'CNY'), before - 500);
  await h.mark('conversion-confirmed');
  h.check('Live AI conversion: quotes, proposal, wrong password refused, confirmed debit', { debitCNY: 500 });

  const transfer = await h.ask('Send 1000 CNY to my own THB wallet for living costs. Compare routes, fees and arrival times, then prepare the transfer for my confirmation.');
  assert.ok(transfer.steps.some(s => s.tool === 'submit_remittance_order'));
  assert.equal(await money(h, 'CNY'), before - 500);
  card = h.page.locator('.plan-card-confirm').filter({ hasText: /Submit transfer/ }).last();
  await h.mark('remittance-proposal');
  await confirmMoney(h, card);
  await card.getByText('Confirmed', { exact: true }).waitFor();
  assert.equal(await money(h, 'CNY'), before - 1500);
  await h.mark('remittance-submitted');
  await h.open('wallet', 'history');
  await h.mark('transfer-order-history');
  await h.page.locator('.money-records').getByRole('button', { name: 'Ledger', exact: true }).click();
  await h.mark('wallet-ledger');
  h.check('Live AI remittance: route comparison, confirmation and order debit', { debitCNY: 1000 });

  await h.ask('Send 15000 CNY to my THB wallet for tuition. Compare routes and prepare the transfer for confirmation.');
  card = h.page.locator('.plan-card-confirm').filter({ hasText: /Submit transfer/ }).last();
  await confirmMoney(h, card);
  const dialog = h.page.getByRole('dialog', { name: 'Review and confirm' });
  await dialog.getByText('Operator approval required').waitFor();
  assert.equal(await money(h, 'CNY'), before - 1500);
  await h.mark('over-limit-blocked');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card.getByRole('button', { name: 'Reject', exact: true }).click();
  await card.getByText('Rejected', { exact: true }).waitFor();
  h.check('Live AI over-limit proposal refused by server without operator approval', { walletUnchanged: true });
  await payBill(h);
}

async function payBill(h) {
  await h.open('wallet', 'pay');
  const data = await h.read('planning/wallet-bills/');
  const bill = data.bills.find(b => b.status === 'DUE' && !b.paid_by_loan && b.kind === 'tuition' && Number(b.amount) < 50000);
  assert.ok(bill, 'Self-funded tuition');
  assert.equal(data.school_payee.verified, true);
  const name = typeof bill.label === 'string' ? bill.label : bill.label.en;
  let row = h.page.locator('.plan-bills-list li').filter({ has: h.page.getByText(name, { exact: true }) }).first();
  await row.scrollIntoViewIfNeeded();
  await h.mark('tuition-shortfall');
  if (await row.getByRole('button', { name: 'Top up', exact: true }).count()) {
    await row.getByRole('button', { name: 'Top up', exact: true }).click();
    await h.mark('bill-topup-review');
    await row.locator('.top-up-form').getByRole('button', { name: /^Top up/ }).click();
    await row.getByRole('button', { name: 'Pay from wallet', exact: true }).waitFor();
  }
  const balance = await money(h, bill.currency);
  await row.getByRole('button', { name: 'Pay from wallet', exact: true }).click();
  const dialog = h.page.getByRole('dialog', { name: 'Review and confirm' });
  await h.mark('tuition-password');
  await dialog.getByLabel('Password').fill(process.env.SHORT_TEST_PASSWORD);
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await h.mark('tuition-paid');
  const after = await h.read('planning/wallet-bills/');
  assert.equal(after.bills.find(b => b.id === bill.id).status, 'PAID');
  assert.ok(Math.abs(balance - await money(h, bill.currency) - Number(bill.amount)) < 0.001);
  const loan = data.bills.find(b => b.paid_by_loan);
  assert.ok(loan);
  const loanLabel = typeof loan.label === 'string' ? loan.label : loan.label.en;
  const loanRow = h.page.locator('.plan-bills-list.is-quiet li').filter({ hasText: loanLabel }).first();
  assert.equal(await loanRow.getByRole('button').count(), 0, 'No duplicate payment action for the loan-covered row');
  const rejected = await h.post(h.context, `planning/bills/${loan.id}/pay-from-wallet/`, {}, [400, 403]);
  await h.open('wallet', 'history');
  await h.page.locator('.money-records').getByRole('button', { name: 'Bill payments', exact: true }).click();
  await h.mark('bill-payment-history');
  h.check('Tuition shortfall, top-up, verified payee, password, paid state and wallet debit', { amount: bill.amount });
  h.check('Loan-covered bill cannot be paid from wallet again', { response: rejected });
}

export async function trustJourney(h) {
  await h.ask('Show my on-time payment record. Explain which actual payments count and whether this is an external credit score.');
  await h.open('trust');
  await h.mark('on-time-record');
  await h.page.getByRole('tab', { name: 'Activity' }).click();
  await h.page.locator('#trust-audit tbody tr').first().waitFor();
  await h.page.locator('#trust-audit').getByLabel('Show').selectOption({ label: 'Sign-in & step-up' });
  await h.mark('security-audit');
  await h.page.getByRole('tab', { name: 'Levels' }).click();
  await h.page.getByRole('button', { name: 'Share my record' }).click();
  const section = h.page.getByRole('dialog', { name: 'Share your on-time record' });
  await section.getByRole('button', { name: 'Take a snapshot now' }).click();
  await section.getByText(/Snapshot taken \(level /).waitFor();
  await section.getByRole('button', { name: /Issue signed statement for the snapshot/ }).first().click();
  await section.getByText('Signed statement issued. It expires in 90 days.').waitFor();
  const statement = await section.getByRole('textbox', { name: 'Signed statement' }).inputValue();
  await h.mark('signed-statement');
  const verifier = await recordedRole(h, 'verifier', `${h.origin}/?verify=1`);
  try {
    await verifier.page.locator('#verify-statement').fill(statement);
    await verifier.page.getByRole('button', { name: 'Verify statement' }).click();
    await verifier.page.getByRole('heading', { name: 'Valid statement', exact: true }).waitFor();
    await verifier.mark('statement-valid');
    await verifier.page.locator('#verify-statement').fill(statement.slice(0, -2) + (statement.endsWith('AA') ? 'BB' : 'AA'));
    await verifier.page.getByRole('button', { name: 'Verify statement' }).click();
    await verifier.page.getByRole('heading', { name: 'Not a valid statement', exact: true }).waitFor();
    await verifier.mark('statement-tampering-rejected', 4);
    assert.equal((await verifier.context.cookies()).some(c => c.name === 'sessionid'), false);
    h.check('Internal on-time record, audit, signed statement, anonymous verification and tamper rejection');
  } finally { await verifier.close(); }
}
