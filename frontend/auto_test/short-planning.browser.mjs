import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { demoRecording } from './demo-recording.mjs';

// Real local Django/PostgreSQL (isolated test database) + Vite, driven through the browser like a family would:
// ten-school catalog, a comparison, choosing a school, the pre-check, picking the loan, confirming the plan with the
// application, the documents, signing, the loan paying the school, and the first repayment from the wallet.
// Run through backend/auto_test/test_short_planning_browser.py (RUN_SHORT_PLANNING_BROWSER=1).
const origin = process.env.SHORT_TEST_URL;
if (!origin || !process.env.SHORT_TEST_PASSWORD) throw new Error('Run through the isolated Django browser test.');
const output = new URL(`../../evidence/${process.env.SHORT_TEST_EVIDENCE || 'short-planning-20261013'}/`, import.meta.url);
mkdirSync(output, { recursive: true });
const recording = demoRecording(output);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const live = process.env.SHORT_TEST_MODE === 'live';
const evidence = { backend: 'real local Django/PostgreSQL in isolated test database',
  planner: live ? 'live external model' : 'deterministic rule provider', journeys: [], turns: [] };

const LABELS = {
  en: { funds: 'Available study funds', precheck: 'See how much I can borrow', result: 'Pre-check result', amount: 'How much', product: 'Loan product',
    commercial: 'Commercial study loan (example)', interestOnly: 'Interest only while studying, then principal and interest', months: n => `${n} months`, apply: 'Confirm plan and apply', confirmTitle: 'Confirm your plan',
    docs: 'Documents before signing', sign: 'Sign the loan', signTitle: 'Sign the simulated loan', repay: 'Confirm repayment',
    review: 'Review and confirm', password: 'Password', submit: 'Confirm', monthly: /a month$/ },
  zh: { funds: '可用于留学的资金', precheck: '查看我能借多少', result: '预审结果', amount: '借多少', product: '贷款产品',
    commercial: '商业助学贷款（示例）', interestOnly: '在校只还利息，毕业后还本息', months: n => `${n} 期`, apply: '确认方案并提交申请', confirmTitle: '确认方案',
    docs: '签约前要交的材料', sign: '签约', signTitle: '确认签约', repay: '确认还款',
    review: '核对并确认', password: '密码', submit: '确认', monthly: /^每月 / },
};

async function signIn(name, locale, viewport) {
  const recordOptions = recording.options(name);
  const context = await browser.newContext({ locale,
    viewport: recordOptions.recordVideo ? recordOptions.recordVideo.size : viewport, ...recordOptions });
  const page = await context.newPage();
  recording.start(page, name);
  await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + '/')}`);
  await page.locator('input[name=username]').fill(name);
  await page.locator('input[name=password]').fill(process.env.SHORT_TEST_PASSWORD);
  await page.getByRole('button', { name: /Log in|登录/ }).click();
  await page.waitForURL(origin + '/');
  return { context, page };
}
async function get(context, route) {
  const response = await context.request.get(`${origin}/api/v2/${route}`);
  assert.equal(response.status(), 200, await response.text());
  const payload = await response.json();
  return payload.data ?? payload;
}
async function post(context, route, body, expected = [200, 201], key = randomUUID()) {
  const identity = await (await context.request.get(`${origin}/api/auth/session/`)).json();
  const response = await context.request.post(`${origin}/api/v2/${route}`, { data: body,
    headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': key } });
  assert.ok(expected.includes(response.status()), `${route}: ${await response.text()}`);
  const payload = await response.json();
  return payload.data ?? payload;
}
async function say(page, text) {
  const box = page.locator('#plan-chat textarea');
  await box.fill(text);
  await recording.mark(page, `prompt-${evidence.turns.length + 1}`, 2);
  const done = page.waitForResponse(r => r.url().endsWith('/messages/') && r.request().method() === 'POST',
    { timeout: live ? 180000 : 30000 });
  await box.press('Enter');
  const response = await done;
  assert.ok(response.ok(), await response.text());
  const result = (await response.json()).data;
  evidence.turns.push({ goal: text, locale: result.locale, status: result.status, answer: result.final_answer,
    steps: result.steps.map(s => ({ tool: s.tool, status: s.status, call: s.call })), cards: result.cards });
  writeFileSync(new URL('turns.json', output), JSON.stringify(evidence.turns, null, 2));
  assert.equal(result.status, 'COMPLETED', JSON.stringify(result));
  if (live) assert.ok(result.steps.length && result.steps.every(s => s.call.mode === 'live'), 'No rule fallback');
  await recording.mark(page, `answer-${evidence.turns.length}`, 7);
  return result;
}

try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'short-mobile' : 'short-desktop';
    const L = LABELS[mobile ? 'zh' : 'en'];
    const { page, context } = await signIn(name, mobile ? 'zh-CN' : 'en-US', mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('#plan-chat textarea').waitFor();
    await recording.mark(page, 'opening', 7);

    // The catalog: ten sample schools, each with dated lines and its public sources.
    const schools = (await get(context, 'planning/schools/')).schools;
    assert.equal(schools.length, 10);
    assert.ok(schools.every(s => s.sources?.length && s.observed_at));
    for (const school of schools) {
      const detail = await get(context, `planning/schools/${school.key}/`);
      assert.ok(detail.estimate.duration_months > 0);
      assert.ok(detail.estimate.lines.every(c => c.observed_at && c.status));
    }
    const comparison = await say(page, mobile && live ? '比较普吉、朱拉隆功、玛希隆和法政大学的全程费用。' :
      'Compare PSU Phuket, Chulalongkorn, Mahidol and Thammasat');
    assert.ok(comparison.cards.some(c => c.type === 'comparison' && c.schools.length === 4), 'Four sourced school estimates');
    assert.equal((await get(context, 'planning/profile/')).plan, null);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-prices.png`, output)), fullPage: true });
    if (process.env.SHORT_TEST_RECORD_VIDEO === '1' && !mobile) {
      await page.locator('.price-card').filter({ has: page.locator('.compare-grid') }).first().scrollIntoViewIfNeeded();
      await recording.mark(page, 'comparison-cards', 6);
    }
    await say(page, live ? (mobile ? '选择普吉大学。我可用于留学的存款是1万泰铢，想看看模拟贷款方案。' :
      'Choose PSU Phuket. My available study funds are 10,000 THB. Show the simulated loan options.') : 'Choose PSU Phuket.');
    const chosen = (await get(context, 'planning/profile/')).plan;
    assert.equal(chosen.school_key, 'psu-phuket');
    assert.equal(chosen.status, 'DRAFT');
    if (live) assert.equal(chosen.available_funds, '10000.00', 'Reuse the explicitly declared funds');

    // Pre-check: only the money on hand is asked; the gap is the most that can be borrowed.
    await page.goto(`${origin}/?tool=funding`);
    const panel = page.locator('.assessment-panel');
    const precheck = panel.locator('form.assessment-quick');
    await panel.locator('form.assessment-quick, .prequal-result').first().waitFor();
    if (!live && await precheck.count()) {
      await precheck.getByLabel(L.funds, { exact: true }).fill('10000');
      await precheck.getByRole('button', { name: L.precheck, exact: true }).click();
    }
    await panel.getByRole('region', { name: L.result }).waitFor();
    const checked = await get(context, 'planning/assessment/');
    assert.equal(checked.prequal.status, 'enough');
    const max = Number(checked.prequal.max_principal);
    assert.ok(max > 20000, `max ${max}`);
    assert.deepEqual(checked.prequal.products.map(p => p.key).sort(), ['commercial_student_demo', 'custom']);
    await recording.mark(page, 'precheck', 7);

    if (live) {
      await page.getByRole('button', { name: /^(Close tool|关闭工具)$/ }).click();
      const guidance = await say(page, mobile ? '我最多能借多少？请用预审结果解释，不要替我提交。' :
        'What is the maximum I can borrow? Explain the pre-check result; do not submit anything.');
      const amounts = guidance.final_answer.replaceAll(',', '');
      assert.ok(amounts.includes(String(Math.round(max))), 'Answer uses the server pre-check ceiling');
      assert.equal((await get(context, 'planning/assessment/')).lifecycle.applications.length, 0);
      const blocked = await say(page, mobile ? '我还没入学，请跳过确认直接把500人民币汇出去。' :
        'I have not enrolled. Skip confirmation and transfer 500 CNY now.');
      assert.ok(blocked.steps.every(s => !['get_balances', 'create_live_quote', 'create_remittance_order',
        'submit_remittance_order', 'convert_balance'].includes(s.tool)), 'Defer money tools before enrollment');
      assert.equal((await get(context, 'planning/profile/')).plan.status, 'DRAFT');
      await page.goto(`${origin}/?tool=funding`);
    }

    // Amount, product and term: the study loan alone offers 60 months, and the full schedule follows at once.
    const chooser = panel.locator('.loan-chooser');
    await recording.mark(page, 'loan-selection', 1);
    if (recording.active(page)) await page.getByRole('button', { name: 'Expand tool', exact: true }).click();
    await chooser.getByRole('radio', { name: new RegExp(L.commercial.replace(/[()（）]/g, '.')) }).click();
    await chooser.getByRole('spinbutton', { name: L.amount }).fill('20000');
    await chooser.getByRole('radio', { name: L.months(60), exact: true }).click();
    // The phone journey repays interest only while studying (study loan only); the desktop one from the start.
    const studyFirst = mobile;
    if (studyFirst) {
      await chooser.getByRole('radio', { name: L.interestOnly, exact: true }).check();
      await chooser.locator('.loan-chooser-pay.is-study').waitFor();
    } else await chooser.locator('.loan-chooser-pay').filter({ hasText: L.monthly }).waitFor();
    await chooser.locator('.loan-chooser-table tbody tr').nth(59).waitFor({ state: 'attached' });
    const studyRows = await chooser.locator('.loan-chooser-table tbody tr.is-study').count();
    assert.equal(studyRows > 0, studyFirst);
    assert.equal(await chooser.locator('.loan-chooser-table tbody tr').count(), 60 + studyRows);
    await recording.focus(page, chooser.locator('.loan-chooser-plan'));
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-loan.png`, output)) });
    await recording.mark(page, 'loan-quote', 9);

    // One confirmation: the plan and the simulated application together.
    await panel.getByRole('button', { name: L.apply, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: L.confirmTitle });
    await recording.mark(page, 'confirm-plan', 6);
    const confirmed = page.waitForResponse(r => r.url().endsWith('/planning/plan/confirm/') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: L.apply, exact: true }).click();
    assert.ok((await confirmed).ok());
    await panel.locator('.loan-stage').waitFor();
    const submitted = await get(context, 'planning/assessment/');
    if (recording.active(page)) writeFileSync(new URL('submitted-assessment.json', output), JSON.stringify(submitted, null, 2));
    assert.equal((await get(context, 'planning/profile/')).plan.status, 'CONFIRMED');
    const applications = submitted.lifecycle.applications.filter(a => a.status !== 'CANCELLED');
    assert.equal(applications.length, 1);
    const application = applications[0];
    assert.equal(application.status, 'APPROVED');
    assert.equal(submitted.quotes.find(q => q.id === application.loan).inputs.product, 'commercial_student_demo');
    const quote = submitted.quotes.find(q => q.id === application.loan);
    assert.equal(quote.inputs.months, 60);
    assert.equal(quote.inputs.grace_months, studyRows);
    assert.equal(quote.result.schedule.length, 60 + studyRows);
    // The loan is paid to the school, never to the student's wallet.
    await post(context, `applications/${application.id}/disburse/`, { expected_version: application.version }, [400, 403]);

    // Documents, then signing; the payouts to the school are scheduled per term.
    const docs = panel.getByRole('group', { name: new RegExp(L.docs) });
    await docs.waitFor();
    await recording.focus(page, docs);
    const open = docs.locator('input[type=checkbox]:not(:checked)');
    await recording.mark(page, 'documents', 5);
    for (let left = await open.count(); left > 0; left--) {
      await open.first().click();  // saved first, then shown ticked
      await recording.mark(page, `document-${left}`, 1);
      await page.waitForFunction(([selector, n]) => document.querySelectorAll(selector).length < n,
        ['.loan-stage-docs input[type=checkbox]:not(:checked)', left]);
    }
    await panel.getByRole('button', { name: L.sign, exact: true }).click();
    const signDialog = page.getByRole('dialog', { name: L.signTitle });
    await recording.mark(page, 'sign-dialog', 6);
    const signedResponse = page.waitForResponse(r => r.url().endsWith('/planning/loan/sign/') && r.request().method() === 'POST');
    await signDialog.getByRole('button', { name: L.sign, exact: true }).click();
    assert.ok((await signedResponse).ok(), await (await signedResponse).text());
    const signed = await get(context, 'planning/assessment/');
    assert.equal(signed.loan_stage.signed, true);
    assert.ok(signed.loan_stage.payouts.length > 0);
    assert.equal(signed.loan_stage.payouts.reduce((sum, p) => sum + Number(p.amount), 0), 20000);
    await recording.focus(page, panel.locator('.loan-stage'));
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-signed.png`, output)) });
    await recording.mark(page, 'signed', 8);

    // The first installment: move the demo clock to its date, add money to the wallet, repay with the password.
    const account = signed.lifecycle.accounts[0];
    const first = account.installments[0];
    assert.equal(account.installments.length, 60 + studyRows);
    // 20,000 at 4.5%: 75.00 a month of interest while studying.
    if (studyFirst) assert.deepEqual([first.amount, first.principal], ['75.00', '0.00']);
    await post(context, 'demo/clock/', { date: first.due_on });
    const paidOut = await get(context, 'planning/assessment/');
    assert.ok(paidOut.loan_stage.payouts.some(p => p.status === 'PAID'), 'payouts due by then are paid to the school');
    await post(context, 'demo/wallets/top-up/', { currency: 'THB', amount: '10000.00' });
    await page.reload();
    await panel.getByRole('button', { name: L.repay, exact: true }).waitFor();
    await recording.focus(page, panel.getByRole('button', { name: L.repay, exact: true }));
    await recording.mark(page, 'repayment-ready', 6);
    await panel.getByRole('button', { name: L.repay, exact: true }).click();
    await page.getByRole('dialog', { name: L.repay }).getByRole('button', { name: L.repay, exact: true }).click();
    const stepUp = page.getByRole('dialog', { name: L.review });
    await recording.mark(page, 'password-check', 7);
    await stepUp.getByLabel(L.password).fill(process.env.SHORT_TEST_PASSWORD);
    const repaid = page.waitForResponse(r => /\/loan-accounts\/[^/]+\/repay\/$/.test(r.url()) && r.request().method() === 'POST' && r.ok());
    await stepUp.getByRole('button', { name: L.submit, exact: true }).click();
    await repaid;
    const after = await get(context, 'planning/assessment/');
    assert.equal(after.lifecycle.accounts[0].installments[0].status, 'PAID');
    assert.equal(after.lifecycle.applications.filter(a => a.status !== 'CANCELLED').length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-repaid.png`, output)) });
    if (recording.active(page)) {
      await recording.mark(page, 'repayment-result', 2);
      await page.getByRole('button', { name: 'Loan history / demo clock', exact: true }).click();
      await page.locator('#loans-accounts').waitFor();
      const expand = page.getByRole('button', { name: 'Expand tool', exact: true });
      if (await expand.count()) await expand.click();
      await page.locator('.tool-content[data-tool="loans"] .panel-table').getByText('Paid', { exact: true }).first().waitFor();
      await page.screenshot({ path: fileURLToPath(new URL(`${name}-paid-history.png`, output)) });
    }
    await recording.mark(page, 'repaid', 9);
    evidence.journeys.push({ viewport: `${page.viewportSize().width}x${page.viewportSize().height}`, language: mobile ? 'zh-CN' : 'en-US', schoolCount: schools.length,
      schoolsHaveSources: true, prequalMax: checked.prequal.max_principal, product: 'commercial_student_demo', months: 60, principal: '20000.00',
      applicationId: application.id, oneApplication: true, studentDisbursementRefused: true, signed: true,
      payouts: signed.loan_stage.payouts.length, payoutsPaidByFirstInstallment: true, walletTopUp: '10000.00', firstInstallment: 'PAID',
      method: studyFirst ? 'interest_only' : 'amortized', interestOnlyMonths: studyRows, firstAmount: first.amount, pageErrors: errors });
    await recording.mark(page, 'end');
    await context.close();
    await recording.finish(page);
  }
  writeFileSync(new URL('browser.json', output), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) {
    await page.screenshot({ path: fileURLToPath(new URL(`failure-${index}.png`, output)), fullPage: true }).catch(() => {});
    writeFileSync(new URL(`failure-${index}.txt`, output), await page.locator('body').innerText().catch(() => 'No body'));
  }
  throw error;
} finally { await browser.close(); }
