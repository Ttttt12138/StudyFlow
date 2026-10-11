// Three independent synthetic accounts. Real nginx -> Django -> PostgreSQL/worker, no response mocks.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { root, backend, python } from '../../support.mjs';

test.use({ actionTimeout: 20_000 });

for (const replay of [1, 2, 3]) test(`reference payment node replay ${replay}: 6000 balance and 9000 reserve gap`, async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const output = `${root}output/frontend/reference-${replay}`;
  mkdirSync(output, { recursive: true });
  const username = `reference-${randomUUID()}`, password = randomUUID();
  const operator = `reference-operator-${randomUUID()}`;
  execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.contrib.auth import get_user_model; U=get_user_model(); U.objects.create_user(username=os.environ["UAT_USER"],password=os.environ["UAT_PASSWORD"]); U.objects.create_user(username=os.environ["UAT_OPERATOR"],password=os.environ["UAT_PASSWORD"],is_staff=True)'],
    { cwd: backend, env: { ...process.env, UAT_USER: username, UAT_OPERATOR: operator, UAT_PASSWORD: password }, stdio: 'pipe' });
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Bangkok', viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  async function login(target, name) {
    await target.goto(`${origin}/api/auth/login/?next=/`);
    await target.getByLabel('Username').fill(name);
    await target.getByLabel('Password').fill(password);
    await target.getByRole('button', { name: 'Log in', exact: true }).click();
  }
  const api = async (path, body, client = page.request) => {
    let response;
    if (body === undefined) response = await client.get(`${origin}/api/v2/${path}`);
    else {
      const identity = await (await client.get(`${origin}/api/auth/session/`)).json();
      response = await client.post(`${origin}/api/v2/${path}`, { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() } });
    }
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    const payload = await response.json();
    return payload.data ?? payload;
  };
  async function versions() {
    const state = await api('readiness/state/');
    return Object.fromEntries(['semester_id', 'state_version', 'budget_version', 'analysis_version'].map(k => [k, state[k]]));
  }
  async function forecastFromBrowser() {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByRole('heading', { name: 'Check your school and dates' }).waitFor();
    await page.getByRole('navigation').getByRole('button', { name: /Budget$/ }).click();
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/readiness/forecasts/' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Update 90-day calendar', exact: true }).click();
    const raw = await response;
    assert.equal(raw.status(), 201, await raw.text());
    await page.getByText('Your payment calendar is ready.').waitFor();
    const run = (await raw.json()).data;
    for (const key of ['state_version', 'budget_version', 'analysis_version'])
      assert.equal(run[key], raw.request().postDataJSON()[key], `forecast ${key} matches requested state`);
    return run;
  }
  try {
    await login(page, username);
    console.log(`Reference ${replay}: nginx login complete`);
    assert.equal(new URL(page.url()).origin, origin, 'login returns to nginx origin');
    const staticResponse = await page.request.get(`${origin}/static/admin/css/base.css`);
    assert.equal(staticResponse.status(), 200, 'login static files are served');
    const rejected = await page.request.post(`${origin}/api/v2/state/`, { data: {} });
    assert.equal(rejected.status(), 403, 'real CSRF enforcement');
    await api('readiness/semesters/', { opening_balance: '80000.00', as_of: '2026-10-02', reserve: '15000.00' });
    const wallet = await api('demo/initialize/', { state_version: (await versions()).state_version });
    assert.equal(wallet.clock, '2026-10-02');
    let state = await versions();
    const semester = await api(`readiness/semesters/${state.semester_id}/`);
    const draft = structuredClone(semester.draft);
    draft.profile.start_date = '2026-10-02';
    draft.profile.end_date = '2026-12-30';
    for (const cost of draft.costs) {
      Object.assign(cost, { amount: null, lower: null, upper: null, paid: null, due_date: null, confidence_type: 'UNCONFIRMED', verification_reference: null, conflict: false, locked: false });
      if (cost.category === 'housing') Object.assign(cost, { amount: '9000.00', currency: 'THB', period: 'once', due_date: '2026-10-05', paid: false });
      if (cost.category === 'tuition') Object.assign(cost, { amount: '65000.00', currency: 'THB', period: 'semester', due_date: '2026-10-15', paid: false });
    }
    await api('readiness/semesters/revise/', { ...state, draft });
    console.log(`Reference ${replay}: isolated clock and draft prepared`);
    // Upload an actual synthetic material and let the running worker process it.
    const identity = await (await page.request.get(`${origin}/api/auth/session/`)).json();
    state = await versions();
    const upload = await page.request.post(`${origin}/api/v2/readiness/imports/`, {
      headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID() },
      multipart: { ...Object.fromEntries(Object.entries(state).map(([k, v]) => [k, String(v)])), kind: 'text',
        file: { name: 'reference-synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('SYNTHETIC reference scope: only October rent and tuition are known. Other costs remain unknown.\nTuition: THB 65000 per semester; year 2026; campus Phuket; unpaid; due 2026-10-15; invoice_id REF-TUITION\nHousing: THB 9000 once; year 2026; campus Phuket; unpaid; due 2026-10-05; invoice_id REF-RENT') } },
    });
    assert.equal(upload.status(), 202, await upload.text());
    const uploaded = (await upload.json()).data;
    let material;
    for (let i = 0; i < 100; i++) {
      material = await api(`readiness/imports/${uploaded.id}/`);
      if (material.status === 'NEEDS_REVIEW') break;
      await page.waitForTimeout(300);
    }
    assert.equal(material.status, 'NEEDS_REVIEW', 'worker processed the actual uploaded material');
    console.log(`Reference ${replay}: worker extraction complete`);
    const resolutions = Object.fromEntries(Object.keys(material.result.merge_conflicts ?? {}).map(k => [k, 'Reviewed against this isolated synthetic reference case.']));
    const selected = draft.costs.filter(c => ['housing', 'tuition'].includes(c.category));
    for (const cost of selected) {
      resolutions[cost.cost_id] = 'Confirmed synthetic October invoice only; no recurring rent or unknown costs assumed.';
      cost.evidence = material.result.draft.costs.find(c => c.category === cost.category)?.evidence ?? [];
    }
    await api(`readiness/imports/${uploaded.id}/confirm/`, { ...await versions(), draft, issuer: 'Synthetic reference issuer', selected_cost_ids: selected.map(c => c.cost_id), conflict_resolutions: resolutions });
    const forecast = await forecastFromBrowser();
    console.log(`Reference ${replay}: browser forecast received`);
    const tuition = forecast.result.timeline.find(row => row.date === '2026-10-15' && row.label === 'tuition');
    assert.ok(tuition, JSON.stringify(forecast.result.timeline));
    assert.equal(tuition.balance_after, '6000.00');
    assert.equal(tuition.reserve_gap, '9000.00');
    assert.equal(forecast.result.timeline.filter(row => ['housing', 'tuition'].includes(row.label)).length, 2, 'state/budget obligations are not double counted');
    assert.equal(forecast.result.complete, false, 'unknown costs remain unknown, not zero');
    assert.ok(forecast.state_version && forecast.budget_version);
    const node = page.locator('.calendar-days > li').filter({ has: page.getByRole('heading', { name: /Oct 15, 2026/ }) });
    assert.match(await node.innerText(), /6,000\.00[\s\S]*9,000\.00/);
    assert.match(await node.innerText(), /balance|Balance/);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await node.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${output}/calendar-${width}.png`, fullPage: true });
      await node.screenshot({ path: `${output}/tuition-node-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByRole('heading', { name: 'Check your school and dates' }).waitFor();
    await page.getByRole('navigation').getByRole('button', { name: /Budget$/ }).click();
    assert.match(await node.innerText(), /6,000\.00[\s\S]*9,000\.00/);
    const promise = await api('sponsor-requests/', { economic_key: `reference-promise-${randomUUID()}`, currency: 'THB', amount: '9000.00', available_on: '2026-10-02', purpose: 'Synthetic reference reserve support' });
    const promised = await forecastFromBrowser();
    assert.equal(promised.result.timeline.find(row => row.id === tuition.id).balance_after, '6000.00', 'promise is not cash');
    const operatorContext = await browser.newContext();
    try {
      const operatorPage = await operatorContext.newPage();
      await login(operatorPage, operator);
      const link = await api(`sponsor-requests/${promise.id}/issue-link/`, { terms_version: 1 }, operatorContext.request);
      const confirmation = await page.request.post(`${origin}/api/v2/sponsor-confirmation/`, { data: { terms_version: 1, decision: 'confirm' }, headers: { 'X-Sponsor-Token': link.token, 'Idempotency-Key': randomUUID() } });
      assert.equal(confirmation.status(), 200, await confirmation.text());
      const confirmed = await forecastFromBrowser();
      assert.equal(confirmed.result.timeline.find(row => row.id === tuition.id).balance_after, '6000.00', 'confirmed promise is still not cash');
      await api(`funding-sources/${promise.source.id}/receive/`, {}, operatorContext.request);
    } finally { await operatorContext.close(); }
    const received = await forecastFromBrowser();
    assert.equal(received.result.timeline.find(row => row.id === tuition.id).balance_after, '15000.00');
    assert.equal(received.result.timeline.find(row => row.id === tuition.id).reserve_gap, '0.00');
    assert.deepEqual(errors, []);
    // Whitelist financial/version fields: never archive cookies, passwords, CSRF or identity payloads.
    const sanitize = run => Object.fromEntries(['id', 'kind', 'state_version', 'budget_version', 'analysis_version', 'result'].map(k => [k, run[k]]));
    writeFileSync(`${output}/responses.json`, JSON.stringify({ initial: sanitize(forecast), promised: sanitize(promised), received: sanitize(received) }, null, 2));
    writeFileSync(`${output}/summary.json`, JSON.stringify({ passed: true, replay, origin, clock: '2026-10-02 Asia/Bangkok', isolated_synthetic_user: username, models: 'mock', worker_processed: material.status, tuition_node: tuition, unknown_costs: 'retained as null; forecast incomplete', version: await versions(), checks: ['nginx login redirect/static/CSRF', 'actual worker upload/review', 'no duplicate obligations', 'desktop/mobile node labels', 'reload restores forecast', 'promise not cash', 'simulated receipt then reforecast'] }, null, 2));
  } finally { await context.close(); }
});
