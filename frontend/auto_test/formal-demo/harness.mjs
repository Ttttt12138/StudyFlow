import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

export function harness(browser) {
  const origin = process.env.FORMAL_DEMO_URL, output = process.env.FORMAL_DEMO_OUTPUT;
  assert.ok(origin && output && process.env.FORMAL_DEMO_PASSWORD, 'Use the isolated Django runner');
  const roles = [], marks = [], turns = [], checks = [], errors = [];
  const save = (name, data) => writeFileSync(join(output, name), JSON.stringify(data, null, 2));
  async function login(role) {
    const dir = join(output, 'raw', role); mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 },
      recordVideo: { dir, size: { width: 1440, height: 900 } } });
    await context.addInitScript(() => localStorage.setItem('studyflow.lang', 'en'));
    const started = performance.now(), page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => { errors.push({ role, error: error.message }); save('page-errors.json', errors); });
    const actor = { role, context, page, started }; roles.push(actor);
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + (role === 'student' ? '/' : '/ops'))}`);
    await page.getByLabel('Username').fill('film-' + role);
    await page.getByLabel('Password').fill(process.env.FORMAL_DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/api/auth/login'));
    return actor;
  }
  async function api(actor, route, body, expected = [200, 201]) {
    let response;
    if (body === undefined) response = await actor.context.request.get(`${origin}/api/v2/${route}`);
    else {
      const session = await (await actor.context.request.get(`${origin}/api/auth/session/`)).json();
      response = await actor.context.request.post(`${origin}/api/v2/${route}`, { data: body,
        headers: { 'X-CSRFToken': session.csrf_token, 'Idempotency-Key': randomUUID() } });
    }
    const payload = await response.json();
    assert.ok(expected.includes(response.status()), `${route}: ${response.status()} ${JSON.stringify(payload)}`);
    return payload.data ?? payload;
  }
  async function mark(actor, name, locator, hold = 4) {
    if (locator) await locator.scrollIntoViewIfNeeded();
    await actor.page.waitForTimeout(450);
    const seconds = (performance.now() - actor.started) / 1000;
    const shot = `${actor.role}-${name}.png`;
    await actor.page.screenshot({ path: join(output, shot) });
    const entry = { name, role: actor.role, start: seconds, screenshot: shot };
    marks.push(entry); save('marks.json', marks);
    console.log(`SHOT ${name}`);
    await actor.page.waitForTimeout(hold * 1000);
    entry.end = (performance.now() - actor.started) / 1000; save('marks.json', marks);
  }
  async function ask(actor, text, name) {
    await actor.page.goto(origin + '/');
    const box = actor.page.locator('.plan-composer textarea');
    await box.fill(text);
    if (name) await mark(actor, name + '-question', box, 1.5);
    const responsePromise = actor.page.waitForResponse(r => r.url().endsWith('/messages/') && r.request().method() === 'POST', { timeout: 240000 });
    await box.press('Enter');
    const response = await responsePromise;
    assert.ok(response.ok(), await response.text());
    const turn = (await response.json()).data;
    turns.push({ goal: text, ...turn }); save('turns.json', turns);
    assert.equal(turn.status, 'COMPLETED', JSON.stringify(turn));
    assert.ok(turn.steps.some(s => s.call.mode === 'live'), 'Every conversational request must invoke the live model');
    assert.ok(turn.steps.every(s => !['rules', 'mock'].includes(s.call.mode)), 'Rules fallback is retained as a failed live attempt');
    assert.ok(!/"\s*[}\]]+\s*$/.test(turn.final_answer), 'No malformed answer suffix');
    await expect(box).toBeEnabled();
    if (name) await mark(actor, name, actor.page.locator('.plan-bubble-agent').last(), 3);
    console.log(`LIVE ${turns.length}: ${text}`);
    return turn;
  }
  function check(name, details = {}) { checks.push({ name, passed: true, ...details }); save('coverage.json', checks); console.log(`PASS ${name}`); }
  async function open(actor, tool, section) {
    await actor.page.goto(`${origin}/?tool=${tool}${section ? '&section=' + section : ''}`);
    await actor.page.getByRole('button', { name: 'Close tool', exact: true }).waitFor();
    const expand = actor.page.getByRole('button', { name: 'Expand tool', exact: true });
    if (await expand.count()) await expand.click();
  }
  async function close(success, failure) {
    const sources = [];
    for (const actor of roles) {
      if (!success) await actor.page.screenshot({ path: join(output, `failure-${actor.role}.png`) }).catch(() => {});
      const path = await actor.page.video().path(); await actor.context.close();
      sources.push({ role: actor.role, path: relative(output, path).replaceAll('\\', '/'),
        timing: 'performance timestamp before page creation; screenshot matching refines the video offset' });
    }
    save('sources.json', sources); save('browser.json', { success, failure: failure?.stack ?? null,
      checks: checks.length, liveTurns: turns.length, pageErrors: errors });
    assert.deepEqual(errors, []);
  }
  return { origin, output, login, api, mark, ask, check, open, close, save, turns,
    password: process.env.FORMAL_DEMO_PASSWORD };
}
