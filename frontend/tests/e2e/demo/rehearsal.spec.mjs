// Full demo rehearsal (docs/demo-script.md) on the compose demo stack: reset the database, then run every
// section through the real UI as the student, payer, operator, approver and an anonymous family member.
// Run three times in a row with `--repeat-each 3`; each run writes steps.json and per-role videos to
// evidence/<DEMO_EVIDENCE>/run-<n>/.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { root } from '../../support.mjs';

const project = process.env.DEMO_COMPOSE_PROJECT || 'studyflow-demo-20261012';
const evidence = `${root}evidence/${process.env.DEMO_EVIDENCE || 'demo-20261012'}`;
const compose = (...args) => execFileSync('docker', ['compose', '-p', project, 'exec', '-T', 'app', ...args], { cwd: root, encoding: 'utf-8', timeout: 180_000 });
const plusMonth = date => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };

test('demo rehearsal: every section of the demo script on a freshly reset demo stack', async ({ browser }, info) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:8098';
  const run = info.repeatEachIndex + 1;
  const dir = `${evidence}/run-${run}`;
  mkdirSync(dir, { recursive: true });
  const steps = [], errors = [], contexts = {}, pages = {};
  const started = new Date();
  async function step(name, body) {
    const begin = Date.now();
    try { await body(); steps.push({ name, ok: true, seconds: (Date.now() - begin) / 1000 }); }
    catch (error) { steps.push({ name, ok: false, seconds: (Date.now() - begin) / 1000, error: String(error.message).slice(0, 500) }); throw error; }
  }

  let credentials;
  await step('reset demo database', async () => {
    const out = compose('python', 'manage.py', 'reset_demo', '--yes');
    assert.match(out, /Demo reset\./);
    credentials = JSON.parse(compose('cat', '.demo-credentials.json'));
    for (const role of ['student', 'operator', 'approver', 'payer']) assert.ok(credentials[role]?.password, `${role} credentials missing`);
  });
  const account = role => credentials[role];

  async function open(role, next, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ locale: 'en-US', viewport, recordVideo: { dir: `${dir}/videos/${role}`, size: { width: 1280, height: 860 } } });
    contexts[role] = context;
    const page = await context.newPage();
    // A stuck step fails within 90 s and names its locator, instead of waiting for the whole test timeout.
    page.setDefaultTimeout(90_000);
    pages[role] = page;
    page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
    if (role === 'family') { await page.goto(next); return page; }
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + next)}`);
    await page.getByLabel('Username').fill(account(role).username);
    await page.getByLabel('Password').fill(account(role).password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    return page;
  }
  async function api(role, path, body) {
    const identity = await (await contexts[role].request.get(`${origin}/api/auth/session/`)).json();
    const response = body === undefined ? await contexts[role].request.get(`${origin}/api/v2/${path}`)
      : await contexts[role].request.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  }
  const opsFor = async (role, student) => {
    const page = pages[role];
    await page.goto(`${origin}/?ops=1`);
    await page.getByRole('heading', { name: 'Operations console' }).waitFor();
    await page.getByLabel('Student', { exact: true }).fill(student);
    return page;
  };
  const confirmIn = async (item, button) => { await item.getByRole('button', { name: button }).click(); await item.getByRole('button', { name: 'Confirm' }).click(); };

  try {
    await step('sign in all roles', async () => {
      await open('payer', '/?payments=1');
      await open('student', '/?wallet=1');
      await open('operator', '/?ops=1');
      await open('approver', '/?ops=1');
      await pages.operator.getByText(`Signed in as operator ${account('operator').username}.`).waitFor();
    });

    // 1. Tuition: authorize, password (one wrong attempt), operator settlement, invoice reconciliation.
    await step('1 tuition payment and reconciliation', async () => {
      const page = pages.payer, detail = page.locator('#pay-detail');
      await page.getByRole('heading', { name: 'Pay a bill' }).waitFor();
      await page.getByRole('row').filter({ hasText: 'Ready to pay' }).getByRole('radio').check();
      await page.getByRole('button', { name: 'Create payment' }).click();
      await detail.getByLabel('I checked the payee, the amount and the invoice.').check();
      await detail.getByRole('button', { name: 'Authorize' }).click();
      await page.getByText('Payment authorized for 15 minutes.').waitFor();
      await detail.getByRole('button', { name: 'Submit payment' }).click();
      await detail.getByLabel('Password').fill(`wrong-${randomUUID()}`);
      await detail.getByRole('button', { name: 'Confirm and submit' }).click();
      await page.getByRole('alert').filter({ hasNotText: 'needs your password' }).waitFor();
      await detail.getByLabel('Password').fill(account('payer').password);
      await detail.getByRole('button', { name: 'Confirm and submit' }).click();
      await page.getByText('Payment submitted. Status: Submitted.').waitFor();
      const ops = await opsFor('operator', 'demo-payer');
      await confirmIn(ops.getByRole('listitem', { name: /^demo-payer · cost:tuition:/ }), 'Settled');
      await ops.getByText('Recorded the simulated adapter result: Settled.').waitFor();
      await page.getByRole('button', { name: 'Refresh' }).click();
      await detail.getByRole('button', { name: 'Reconcile with invoice' }).click();
      await page.getByText('Receipt matches the invoice. The payment is reconciled.').waitFor();
      for (const name of ['Password re-check failed', 'Password re-check passed', 'Settled (sandbox)', 'Reconciled with invoice'])
        await detail.locator('.pay-audit').getByText(name, { exact: true }).waitFor();
      await page.screenshot({ path: `${dir}/1-payment-reconciled.png`, fullPage: true });
    });

    // 2. Over-limit transfer: the verifying operator is blocked, the second operator approves.
    await step('2 over-limit transfer with second-person approval', async () => {
      const page = pages.student, button = name => page.getByRole('button', { name, exact: true });
      await page.getByRole('heading', { name: 'Wallet & transfers', exact: true }).waitFor();
      const corridor = (await api('student', 'corridors/')).find(row => row.source_currency === 'CNY' && row.target_currency === 'THB');
      const payee = (await api('student', 'beneficiaries/')).results.find(row => row.verified);
      await page.getByLabel('Currency route').selectOption(corridor.id);
      await page.getByLabel('Send amount').fill('15000.00');
      await button('Get backend quotes').click();
      await page.getByText(/backend-priced routes? returned/).waitFor();
      await page.locator('.wallet-quote-grid').getByRole('button', { name: 'Select quote' }).first().click();
      await page.getByLabel('Recipient', { exact: true }).selectOption('BENEFICIARY');
      await page.getByLabel('Beneficiary', { exact: true }).selectOption(payee.id);
      await button('Create order for review').click();
      await page.getByText('Simulated order prepared. Review its backend-priced details before submitting.').waitFor();
      await page.getByRole('checkbox', { name: /I reviewed this exact simulated transfer/ }).check();
      await button('Confirm submission').click();
      await page.getByRole('heading', { name: 'Operator approval required' }).waitFor();
      await button('Request operator approval').click();
      await page.getByText(/Approval requested/).waitFor();

      const ops = await opsFor('operator', 'demo-student');
      const blocked = ops.getByRole('article').filter({ hasText: 'CNY 15,000.00' });
      await blocked.getByText('You verified this payee, so another operator must decide.').waitFor();
      assert.equal(await blocked.getByRole('button', { name: 'Approve' }).count(), 0);
      await ops.screenshot({ path: `${dir}/2-separation-of-duties.png`, fullPage: true });

      const approver = await opsFor('approver', 'demo-student');
      const card = approver.getByRole('article').filter({ hasText: 'CNY 15,000.00' });
      await card.getByLabel('Decision note (shown to the student)').fill('Payee and purpose checked');
      await confirmIn(card, 'Approve');
      await approver.getByText('Approved. demo-student can now submit with their password.').waitFor();

      await button('Refresh from Django').click();
      await button('Continue to password check').click();
      await page.getByLabel('Password', { exact: true }).fill(account('student').password);
      await button('Authorize and submit').click();
      await page.getByText('Django reports: SUBMITTED.', { exact: true }).waitFor();

      await ops.getByRole('button', { name: 'Refresh' }).click();
      const transfer = ops.getByRole('listitem', { name: 'demo-student · CNY → THB' });
      await confirmIn(transfer, 'Dispatched');
      await ops.getByText('Recorded the simulated adapter result: Dispatched.').waitFor();
      await confirmIn(transfer, 'Delivered');
      await ops.getByText('Recorded the simulated adapter result: Delivered.').waitFor();
    });

    // 3. Conversion with the password step-up, and the ledger.
    await step('3 currency conversion and ledger', async () => {
      const page = pages.student;
      await page.goto(`${origin}/?wallet=1`);
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Convert between currencies' }) });
      await section.getByLabel('Convert from').selectOption('CNY');
      await section.getByLabel('Convert to').selectOption('THB');
      await section.getByLabel('Amount to convert (CNY)').fill('2000');
      await section.getByRole('button', { name: 'Get conversion quotes' }).click();
      await page.getByText(/quote\(s\) returned/).waitFor();
      await section.getByRole('button', { name: 'Use this quote' }).first().click();
      await section.getByLabel(/I reviewed these exact amounts/).check();
      await section.getByRole('button', { name: 'Convert now' }).click();
      await section.getByLabel('Password', { exact: true }).fill(account('student').password);
      await section.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.getByText('Conversion recorded. Balances and the ledger were refreshed.').waitFor();
      const legs = (await api('student', 'ledger/')).results.filter(row => row.conversion);
      assert.deepEqual(legs.map(row => row.currency).sort(), ['CNY', 'THB']);
      await page.screenshot({ path: `${dir}/3-conversion.png`, fullPage: true });
    });

    // 4. Transaction import, then recalculation (no wallet cash is created).
    await step('4 transaction import and recalculation', async () => {
      const page = pages.payer;
      const before = (await api('payer', 'readiness/state/')).assets.wallet_balance;
      await page.goto(`${origin}/?insights=1`);
      await page.getByRole('heading', { name: 'Spending insights', level: 1 }).waitFor();
      await page.getByLabel('Where the file comes from').selectOption('synthetic');
      await page.getByLabel('CSV file').setInputFiles(`${root}backend/examples/consumption/v1/rising-costs.csv`);
      await page.getByRole('button', { name: 'Upload and preview' }).click();
      const review = page.locator('.insights-review');
      await review.getByLabel('Select all rows').check();
      await review.getByRole('button', { name: 'Confirm import' }).click();
      await page.getByText(/^Import confirmed: \d+ rows? added\.$/).waitFor();
      await page.getByText(/^(Forecast recalculated\.|The recalculation is taking longer than a minute\..*)$/).waitFor({ timeout: 90_000 });
      assert.equal((await api('payer', 'readiness/state/')).assets.wallet_balance, before);
      await page.screenshot({ path: `${dir}/4-import-recalculated.png`, fullPage: true });
    });

    // 5. Family support: request, operator link, anonymous confirmation, receipt.
    await step('5 family support with anonymous confirmation', async () => {
      const page = pages.student;
      const clock = (await api('student', 'demo/wallets/')).results[0].clock;
      const purpose = `Demo rent help ${run}`;
      await page.goto(`${origin}/?family=1`);
      await page.getByRole('heading', { name: 'Family support requests' }).waitFor();
      await page.getByLabel('Amount', { exact: true }).fill('6500');
      await page.getByLabel('Currency').selectOption('THB');
      await page.getByLabel('Available on', { exact: true }).fill(clock);
      await page.getByLabel('Purpose', { exact: true }).fill(purpose);
      await page.getByRole('button', { name: 'Create request' }).click();
      await page.getByText(/Request created \(reference /).waitFor();

      const ops = await opsFor('operator', 'demo-student');
      const request = ops.getByRole('listitem', { name: `demo-student · ${purpose}` });
      await confirmIn(request, 'Create confirmation link');
      const link = await request.getByLabel('Confirmation link').inputValue();

      const family = await open('family', link, { width: 390, height: 844 });
      await family.getByText(purpose).waitFor();
      assert.equal(new URL(family.url()).hash, '');
      await family.getByRole('button', { name: 'Confirm support' }).click();
      await family.getByLabel(/I confirm I plan to provide this support/).check();
      await family.getByRole('button', { name: 'Send confirmation' }).click();
      await family.getByText(/your confirmation was recorded/).waitFor();
      await family.screenshot({ path: `${dir}/5-family-confirmed-mobile.png`, fullPage: true });

      await ops.getByRole('button', { name: 'Refresh' }).click();
      await confirmIn(request, 'Record money received');
      await ops.getByText('THB 6,500.00 recorded as received.').waitFor();
      await page.reload();
      await page.getByText('Received — an operator recorded the money.').waitFor();
    });

    // 6. Loan: quote, affordable application, operator disbursement, demo clock, repayment with password.
    await step('6 loan from quote to first repayment', async () => {
      const page = pages.student;
      const clock = (await api('student', 'demo/wallets/')).results[0].clock;
      await page.goto(`${origin}/?loans=1`);
      await page.getByRole('heading', { name: 'Loans', exact: true }).waitFor();
      await page.getByLabel('Principal THB').fill('12000');
      await page.getByLabel('Annual interest rate %').fill('8');
      await page.getByLabel('Fees THB').fill('0');
      await page.getByLabel('Months', { exact: true }).fill('3');
      await page.getByLabel('First due date').fill(plusMonth(clock));
      await page.getByRole('button', { name: 'Create loan quote' }).click();
      await page.getByText('Loan quote created. Review it below, then apply with it.').waitFor();
      const quote = (await api('student', 'loans/')).results.find(row => row.inputs?.months === 3 && row.result?.principal === '12000.00');
      const months = [...new Set(quote.result.repayments.map(row => row.due_date.slice(0, 7)))]
        .map(month => ({ month, income: '30000.00', living_expenses: '12000.00', existing_repayments: '0.00' }));
      const profile = await api('student', 'affordability-profile/');
      await api('student', 'affordability-profile/', { expected_version: profile.version ?? 0, months });
      await page.reload();
      await page.getByRole('button', { name: 'Apply with this quote' }).first().click();
      await page.getByText('Simulated application draft created.').waitFor();
      await page.getByLabel(/I understand this is a simulated application/).check();
      await page.getByRole('button', { name: 'Submit simulated application' }).click();
      await page.getByText('Application submitted. Status: Approved.').waitFor();

      const ops = await opsFor('operator', 'demo-student');
      await confirmIn(ops.getByRole('listitem', { name: 'demo-student · loan application' }), 'Disburse');
      await ops.getByText('Disbursed. The student now has an active loan account.').waitFor();

      await page.reload();
      await page.getByLabel('I understand this changes the simulated date for my demo account only.').check();
      await page.getByRole('button', { name: /^Move demo date to / }).click();
      await page.getByLabel(/I confirm repaying /).check();
      await page.getByRole('button', { name: 'Repay installment 1' }).click();
      await page.getByLabel('Password', { exact: true }).fill(account('student').password);
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.getByText(/Installment 1 repaid/).waitFor();
      await page.screenshot({ path: `${dir}/6-loan-repaid.png`, fullPage: true });
    });

    // 7. Compare plans (formerly the what-if planner): compare a scenario, preview the change, apply it explicitly (no money moves).
    await step('7 what-if scenario compared and applied', async () => {
      const page = pages.payer;
      const clock = (await api('payer', 'demo/wallets/')).results[0].clock;
      const before = (await api('payer', 'readiness/state/')).assets.wallet_balance;
      await page.goto(`${origin}/?copilot=1`);
      await page.getByRole('heading', { name: 'Compare plans' }).waitFor();
      await page.getByText(/Comparing against plan versions/).waitFor();
      const form = page.locator('fieldset.copilot-form').first();
      await form.getByLabel('Scenario name').fill('Cook at home');
      await form.getByRole('button', { name: 'Add cost change' }).click();
      await form.getByRole('combobox', { name: /^Cost/ }).selectOption('food');
      await form.getByLabel('New amount (THB)').fill('2500');
      await form.getByLabel('Effective from').fill(clock);
      await page.getByRole('button', { name: 'Compare' }).click();
      await page.getByText('Comparison ready. Nothing in your plan has changed.').waitFor();
      const results = page.locator('#copilot-results');
      await results.getByRole('columnheader', { name: 'Cook at home' }).waitFor();
      await page.screenshot({ path: `${dir}/7-what-if-compared.png`, fullPage: true });
      await results.getByRole('button', { name: 'Preview applying' }).click();
      const apply = page.locator('#copilot-apply');
      await apply.getByLabel('I confirm applying exactly these changes to my plan.').check();
      await apply.getByRole('button', { name: 'Apply to my plan' }).click();
      await page.getByText('Scenario applied to your plan. No money moved.').waitFor();
      assert.equal((await api('payer', 'readiness/state/')).assets.wallet_balance, before);
    });

    // 8. Trust center: limits and audit, then a signed on-time statement checked by someone without an account.
    await step('8 signed credit statement verified anonymously', async () => {
      const page = pages.student;
      await page.goto(`${origin}/?trust=1`);
      await page.getByRole('heading', { name: 'Permissions & activity' }).waitFor();
      const section = page.locator('#trust-statements');
      await section.getByRole('button', { name: 'Take a snapshot now' }).click();
      await section.getByText(/Snapshot taken \(level /).waitFor();
      await section.getByRole('button', { name: /Issue signed statement for the snapshot/ }).first().click();
      await section.getByText('Signed statement issued. It expires in 90 days.').waitFor();
      const statement = await section.getByRole('textbox', { name: 'Signed statement' }).inputValue();
      await page.screenshot({ path: `${dir}/8-statement-issued.png`, fullPage: true });
      const landlord = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, recordVideo: { dir: `${dir}/videos/verifier`, size: { width: 390, height: 844 } } });
      contexts.verifier = landlord;
      const check = await landlord.newPage();
      check.setDefaultTimeout(90_000);
      check.on('pageerror', error => errors.push(`verifier: ${error.message}`));
      await check.goto(`${origin}/?verify=1`);
      await check.locator('#verify-statement').fill(statement);
      await check.getByRole('button', { name: 'Verify statement' }).click();
      await check.getByRole('heading', { name: 'Valid statement' }).waitFor();
      await check.locator('#verify-statement').fill(statement.slice(0, -2) + (statement.endsWith('A') ? 'BB' : 'AA'));
      await check.getByRole('button', { name: 'Verify statement' }).click();
      await check.getByRole('heading', { name: 'Not a valid statement' }).waitFor();
    });

    assert.deepEqual(errors, []);
  } finally {
    // The record is written first, so a failure while closing (or a timeout) still leaves evidence.
    writeFileSync(`${dir}/steps.json`, JSON.stringify({
      run, project, origin, started: started.toISOString(), finished: new Date().toISOString(),
      passed: steps.length > 0 && steps.every(row => row.ok) && errors.length === 0, steps, page_errors: errors,
      is_simulated: true,
    }, null, 2));
    for (const context of Object.values(contexts)) await context.close().catch(() => {});
  }
});
