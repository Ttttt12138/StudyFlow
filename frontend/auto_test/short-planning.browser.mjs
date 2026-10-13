import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const origin = process.env.SHORT_TEST_URL;
if (!origin || !process.env.SHORT_TEST_PASSWORD) throw new Error('Run through the isolated Django browser test.');
const output = new URL(`../../evidence/${process.env.SHORT_TEST_EVIDENCE || 'short-planning-20261013'}/`, import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const evidence = { backend: 'real local Django/PostgreSQL in isolated test database', planner: 'deterministic rule provider', journeys: [] };

async function signIn(name, locale, viewport) {
  const context = await browser.newContext({ locale, viewport });
  const page = await context.newPage();
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
  const done = page.waitForResponse(r => r.url().endsWith('/messages/') && r.request().method() === 'POST');
  await box.press('Enter');
  const response = await done;
  assert.ok(response.ok(), await response.text());
  const result = (await response.json()).data;
  assert.equal(result.status, 'COMPLETED', JSON.stringify(result));
  return result;
}

async function standaloneExample(page, mobile, name) {
  await page.goto(`${origin}/?loans=1`);
  await page.getByRole('tab', { name: mobile ? '报价' : 'Quote', exact: true }).click();
  await page.getByRole('button', { name: mobile ? '调整参数' : 'Adjust terms', exact: true }).click();
  const form = page.locator('#loans-terms');
  const product = form.getByLabel(mobile ? '贷款选项' : 'Loan option', { exact: true });
  await product.selectOption('custom');
  await form.getByLabel(mobile ? '手续费 THB' : 'Fees THB', { exact: true }).fill('900');
  await product.selectOption('commercial_student_demo');
  assert.equal(await form.getByLabel(mobile ? '期数（月）' : 'Months', { exact: true }).inputValue(), '48');
  assert.equal(await form.getByLabel(mobile ? '年利率 %' : 'Annual interest rate %', { exact: true }).inputValue(), '6');
  assert.equal(await form.getByLabel(mobile ? '手续费 THB' : 'Fees THB', { exact: true }).inputValue(), '0.00');
  await form.getByLabel(mobile ? '本金 THB' : 'Principal THB', { exact: true }).fill('18000');
  await form.evaluate(node => Promise.all(node.closest('.panel-sheet').getAnimations({ subtree: true }).map(animation => animation.finished)));
  const sheetStyle = await form.evaluate(node => {
    const style = getComputedStyle(node.closest('.panel-sheet'));
    return { opacity: style.opacity, background: style.backgroundColor };
  });
  assert.deepEqual(sheetStyle, { opacity: '1', background: 'rgb(255, 255, 255)' });
  await page.screenshot({ path: fileURLToPath(new URL(`${name}-commercial-option.png`, output)), animations: 'disabled' });
  const pending = page.waitForResponse(r => r.url().endsWith('/loans/') && r.request().method() === 'POST');
  await page.getByRole('button', { name: mobile ? '创建贷款报价' : 'Create loan quote', exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 201, await response.text());
  const quote = (await response.json()).data;
  assert.equal(quote.inputs.product, 'commercial_student_demo');
  assert.equal(quote.result.net_proceeds, '18000.00');
  await page.locator('#loans-quote').getByText(mobile ? '商业助学贷款（示例）' : 'Commercial study loan (example)', { exact: true }).waitFor();
}

try {
  const operator = await signIn('short-operator', 'en-US', { width: 1440, height: 1000 });
  for (const mobile of [false, true]) {
    const name = mobile ? 'short-mobile' : 'short-desktop';
    const { page, context } = await signIn(name, mobile ? 'zh-CN' : 'en-US', mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const schools = (await get(context, 'planning/schools/')).schools;
    assert.equal(schools.length, 10);
    for (const school of schools) {
      const detail = await get(context, `planning/schools/${school.key}/`);
      assert.ok(detail.estimate.duration_months > 0);
      assert.ok(detail.estimate.lines.every(c => c.observed_at && c.status));
    }
    await say(page, 'Compare PSU Phuket, Chulalongkorn, Mahidol and Thammasat');
    assert.equal((await get(context, 'planning/profile/')).plan, null);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-prices.png`, output)), fullPage: true });
    await say(page, 'Choose PSU Phuket. Savings 10000 THB, monthly income 30000 THB, monthly expenses 10000 THB, existing repayments 0 THB. Borrow 20000 THB.');
    const panel = page.locator('.assessment-panel');
    await panel.locator('form').waitFor();
    const input = mobile ? { reserve: '希望保留的资金', payment: '首次固定费用付款日期', view: '查看我的方案', review: '核对申请', confirm: '确认并提交申请', dialog: '确认模拟贷款申请', refresh: '刷新状态', repay: '确认还款' }
      : { reserve: 'Money to keep aside', payment: 'First fixed payment date', view: 'View my options', review: 'Review application', confirm: 'Confirm and submit application', dialog: 'Confirm simulated loan application', refresh: 'Refresh status', repay: 'Confirm repayment' };
    assert.equal(await panel.getByLabel(mobile ? '可用于留学的资金' : 'Available study funds', { exact: true }).inputValue(), '10000.00');
    assert.equal(await panel.getByLabel(mobile ? '收入（含家庭支持）' : 'Income including family support', { exact: true }).inputValue(), '30000.00');
    await panel.getByLabel(input.reserve, { exact: true }).fill('0');
    await panel.getByLabel(input.payment, { exact: true }).fill('2027-08-08');
    const productName = mobile ? '商业助学贷款（示例）' : 'Commercial study loan (example)';
    assert.equal(await panel.getByLabel(mobile ? '拟借金额（可选）' : 'Amount to borrow (optional)', { exact: true }).inputValue(), '20000.00');
    await panel.getByRole('button', { name: input.view, exact: true }).click();
    await panel.locator('.assessment-quotes article').first().waitFor();
    assert.equal(await panel.locator('.assessment-quotes article').count(), 3);
    const before = await get(context, 'planning/assessment/');
    const layout = await page.evaluate(() => ({ scrollY, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
      workspaceTop: document.querySelector('.student-workspace').getBoundingClientRect().top,
      dockTop: document.querySelector('.workspace-dock').getBoundingClientRect().top }));
    writeFileSync(new URL(`${name}-layout.json`, output), JSON.stringify(layout));
    assert.equal(before.quotes[0].inputs.months, 48);
    assert.equal(before.quotes[1].inputs.months, 24);
    assert.deepEqual(before.quotes.map(q => q.inputs.product), ['custom', 'custom', 'commercial_student_demo']);
    assert.equal(before.quotes[2].inputs.months, 48);
    assert.equal(before.quotes[0].assessment.status, 'AFFORDABLE');
    let releaseOldRead, markOldRead;
    const oldReadStarted = new Promise(resolve => { markOldRead = resolve; });
    const holdOldRead = new Promise(resolve => { releaseOldRead = resolve; });
    let held = false;
    await page.route('**/api/v2/planning/assessment/', async route => {
      if (route.request().method() !== 'GET' || held) return route.continue();
      held = true;
      const old = await route.fetch();
      markOldRead();
      await holdOldRead;
      await route.fulfill({ response: old });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('studyflow:write')));
    await oldReadStarted;
    await panel.getByRole('button', { name: mobile ? '修改资料' : 'Edit details', exact: true }).click();
    await panel.getByLabel(mobile ? '拟借金额（可选）' : 'Amount to borrow (optional)', { exact: true }).fill('22000');
    await panel.getByRole('button', { name: input.view, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.assessment-panel form'));
    const revised = await get(context, 'planning/assessment/');
    assert.equal(revised.quotes[0].result.principal, '22000.00');
    assert.notEqual(revised.quotes[0].id, before.quotes[0].id);
    const staleReply = page.waitForResponse(async response => response.url().endsWith('/planning/assessment/') &&
      response.request().method() === 'GET' && (await response.json()).data.version === before.version);
    releaseOldRead();
    await staleReply;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => document.querySelector('.assessment-summary')?.textContent.includes('22000'));
    await panel.getByRole('radio', { name: productName, exact: true }).check();
    await page.evaluate(() => { window.print = () => { window.printedSummary = document.getElementById('planning-print-summary')?.textContent; }; });
    await panel.getByRole('button', { name: mobile ? '打印摘要' : 'Print summary', exact: true }).click();
    assert.match(await page.evaluate(() => window.printedSummary), /22000/);
    assert.ok((await page.evaluate(() => window.printedSummary)).includes(productName));
    await panel.locator('..').evaluate(node => node.closest('.panel-body')?.scrollTo(0, 0));
    const wallets = await get(context, 'demo/wallets/');
    assert.equal((wallets.results ?? wallets)[0].balance, '0.00');
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-options.png`, output)) });
    await panel.getByRole('button', { name: input.review, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: input.dialog });
    await dialog.getByText(productName, { exact: true }).waitFor();
    await dialog.getByRole('button', { name: input.confirm, exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const submitted = await get(context, 'planning/assessment/');
    assert.equal(submitted.lifecycle.applications.length, 1);
    const application = submitted.lifecycle.applications[0];
    assert.equal(application.loan, revised.quotes[2].id);
    assert.equal(application.status, 'APPROVED');
    const payload = { expected_version: submitted.version, plan_version: submitted.plan_version, quote_id: application.loan };
    const replay = await post(context, 'planning/loan-applications/', payload);
    assert.equal(replay.application.id, application.id);
    await post(context, `applications/${application.id}/disburse/`, { expected_version: application.version }, [403]);
    const funded = await post(operator.context, `applications/${application.id}/disburse/`, { expected_version: application.version });
    await panel.getByRole('button', { name: input.refresh, exact: true }).click();
    const next = funded.account.installments[0];
    await post(context, 'demo/clock/', { date: next.due_on });
    await panel.getByRole('button', { name: input.refresh, exact: true }).click();
    await panel.getByRole('button', { name: input.repay, exact: true }).click();
    await page.getByRole('dialog', { name: input.repay }).getByRole('button', { name: input.repay, exact: true }).click();
    const stepup = page.locator('dialog.workspace-confirm');
    await stepup.locator('input[type=password]').fill(process.env.SHORT_TEST_PASSWORD);
    await stepup.locator('button[type=submit]').click();
    await stepup.waitFor({ state: 'hidden' });
    const after = await get(context, 'planning/assessment/');
    assert.equal(after.lifecycle.accounts[0].installments[0].status, 'PAID');
    assert.equal(after.lifecycle.applications.length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-repaid.png`, output)) });
    await standaloneExample(page, mobile, name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    evidence.journeys.push({ viewport: mobile ? '390x844' : '1440x1000', language: mobile ? 'zh-CN' : 'en-US', schoolCount: schools.length,
      quoteTerms: [48, 24, 48], applicationId: application.id, firstInstallment: 'PAID', declaredFundsDoNotCreditWallet: true,
      repeatedSubmissionOneApplication: true, studentDisbursementForbidden: true, staleReadDoesNotReplaceNewQuote: true,
      editedPrincipal: '22000.00', printSummaryContentChecked: true, product: 'commercial_student_demo',
      productInConfirmationAndSummary: true, standaloneProductPresetChecked: true, pageErrors: errors });
    await context.close();
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
