import { test, expect } from '@playwright/test';
import { screenshot } from '../../support.mjs';
import { approval, payment, order, payee, loan, sponsor, item, workbench, openOpsItem, id } from '../../operations-support.mjs';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function mock(page, handler) {
  await page.route('**/api/auth/session/', route => route.fulfill({ json: { authenticated: true, username: 'op', csrf_token: 't' } }));
  await page.route('**/api/v2/**', handler);
}
const tasks = page => page.getByRole('navigation', { name: 'Operations sections' }).getByRole('button', { name: /^Work queue/ }).click();

for (const width of [1440, 390]) {
  test(`preview ${width}px: dashboard, drilldown, read-only details, keyboard and Chinese`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let calls = 0; const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { calls++; return route.abort(); });
    await page.goto(`${base}/ops?ops=preview`);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.locator('.ops-metric')).toHaveCount(4);
    await expect(page.locator('.app-backdrop')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Operations sections' }).getByRole('button')).toHaveCount(3);
    if (width === 1440) await expect(page.getByRole('heading', { name: 'Workload by type' })).toBeInViewport();
    await page.screenshot({ path: screenshot(`ops-overview-${width}-en.png`), fullPage: true });
    await page.locator('.metric-unknown').click();
    await expect(page.getByLabel('Attention', { exact: true })).toHaveValue('unknown');
    await expect(page.locator('.ops-table tbody tr')).toHaveCount(1);
    const opener = page.getByRole('button', { name: 'View', exact: true });
    await opener.click();
    const detail = page.getByRole('dialog');
    await expect(detail.getByRole('button', { name: 'Settled' })).toBeDisabled();
    for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); expect(await detail.evaluate(el => el.contains(document.activeElement))).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0); await expect(opener).toBeFocused();
    await tasks(page);
    await page.getByLabel('Type', { exact: true }).selectOption('approvals');
    await openOpsItem(page, 'approval', 'CNY');
    await expect(page.getByText('You verified this payee, so another operator must decide.')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: '总览', exact: true }).click();
    await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".ops-content")).toHaveAttribute("aria-busy", "false");
    await page.screenshot({ path: screenshot(`ops-overview-${width}-zh.png`), fullPage: true });
    expect(calls).toBe(0); expect(errors).toEqual([]);
  });
}

test('staff permission errors do not render metrics', async ({ page }) => {
  await mock(page, route => json(route, 403, { detail: 'Staff only' }));
  await page.goto(`${base}/?ops=1`);
  await expect(page.getByRole('heading', { name: 'Operations staff only' })).toBeVisible();
  await expect(page.locator('.ops-metric')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in as operator' })).toBeVisible();
});

test('approval confirmation preserves notes and explains separation of duties', async ({ page }) => {
  const posts = [];
  await mock(page, route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return json(route, 403, { code: 'SEPARATION_OF_DUTIES', detail: 'Separation of duties.' }); }
    return json(route, 200, { data: workbench([item('approval', { ...approval, can_decide: !posts.length, blocked_reason: posts.length ? 'VERIFIED_PAYEE' : null })]) });
  });
  await page.goto(`${base}/ops`); const detail = await openOpsItem(page, 'approval');
  await detail.getByLabel('Decision note (shown to the student)').fill('checked');
  await detail.getByRole('button', { name: 'Approve', exact: true }).click();
  expect(posts).toHaveLength(0);
  await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('Separation of duties');
  await expect(detail.getByText('You verified this payee, so another operator must decide.')).toBeVisible();
  expect(posts).toEqual([{ decision: 'approve', note: 'checked', expected_version: 1 }]);
});

test('successful write then failed refresh only retries the read', async ({ page }) => {
  let posts = 0, failRead = false;
  await mock(page, route => {
    if (route.request().method() === 'POST') { posts++; failRead = true; return json(route, 201, { data: {} }); }
    if (failRead) return json(route, 503, { detail: 'Temporarily unavailable' });
    return json(route, 200, { data: workbench(posts ? [] : [item('payment', payment)]) });
  });
  await page.goto(`${base}/ops`); const detail = await openOpsItem(page, 'payment');
  await detail.getByRole('button', { name: 'Settled', exact: true }).click();
  await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('Action recorded, but refresh failed');
  await expect(detail.getByRole('button', { name: 'Settled', exact: true })).toBeDisabled();
  failRead = false;
  await detail.getByRole('button', { name: 'Retry refresh' }).click();
  await expect(detail).toHaveCount(0); expect(posts).toBe(1);
  await expect(page.locator('.metric-total strong')).toHaveText('0');
});

test('409 refreshes the selected record and requires a new confirmation', async ({ page }) => {
  const posts = [];
  await mock(page, route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return json(route, 409, { detail: 'Changed' }); }
    return json(route, 200, { data: workbench([item('approval', { ...approval, version: posts.length ? 2 : 1 })]) });
  });
  await page.goto(`${base}/ops`); const detail = await openOpsItem(page, 'approval');
  for (let n = 0; n < 2; n++) {
    await detail.getByRole('button', { name: 'Reject', exact: true }).click();
    await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(detail.getByRole('alert')).toContainText('This item changed');
    await expect(detail.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
  }
  expect(posts.map(row => row.expected_version)).toEqual([1, 2]);
});

test('sponsor link stays in the fragment; receipt and loan disbursement keep their contracts', async ({ page }) => {
  const posts = [], token = 'ab'.repeat(32);
  await mock(page, route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v2/', '');
    if (route.request().method() === 'POST') {
      posts.push([path, route.request().postDataJSON()]);
      return json(route, 201, { data: path.includes('issue-link') ? { token, expires_at: '2026-10-14T00:00:00Z' } : { account: { id: 'acc' } } });
    }
    const items = [];
    if (!posts.some(([p]) => p.includes('/receive/'))) items.push(item('sponsor', { ...sponsor, status: posts.length ? 'CONFIRMED' : 'PENDING' }));
    if (!posts.some(([p]) => p.includes('/disburse/'))) items.push(item('loan', loan));
    return json(route, 200, { data: workbench(items) });
  });
  await page.goto(`${base}/ops`); let detail = await openOpsItem(page, 'sponsor');
  await detail.getByRole('button', { name: 'Create confirmation link' }).click(); await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail.getByLabel('Confirmation link')).toHaveValue(`${base}/?sponsor=1#token=${token}`);
  await detail.getByRole('button', { name: 'Record money received' }).click(); await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail).toHaveCount(0);
  detail = await openOpsItem(page, 'loan');
  await detail.getByRole('button', { name: 'Disburse', exact: true }).click(); await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Disbursed. The student now has an active loan account.')).toBeVisible();
  expect(posts).toEqual([[`sponsor-requests/${sponsor.id}/issue-link/`, { terms_version: 2 }], [`funding-sources/${sponsor.source.id}/receive/`, { hold_in_source_currency: false }], [`applications/${loan.id}/disburse/`, { expected_version: 3 }]]);
});

test('notes entered during confirmation are sent for reassessment and transfer outcomes', async ({ page }) => {
  const posts = [];
  await mock(page, route => {
    if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return json(route, 201, { data: { status: 'APPROVED' } }); }
    return json(route, 200, { data: workbench([item('loan', { ...loan, status: posts.length ? 'APPROVED' : 'UNDER_REVIEW' }), item('order', order)]) });
  });
  await page.goto(`${base}/ops`); let detail = await openOpsItem(page, 'loan');
  await detail.getByRole('button', { name: /Re-assess/ }).click();
  await detail.getByRole('textbox').fill('Profile checked'); await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Disburse', exact: true })).toBeEnabled();
  await detail.getByRole('button', { name: 'Close details' }).click();
  detail = await openOpsItem(page, 'order');
  await detail.getByRole('button', { name: 'Dispatched', exact: true }).click();
  await detail.getByRole('textbox').fill('Adapter reported dispatch'); await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail.getByText('Recorded the simulated adapter result: Dispatched.')).toBeVisible();
  expect(posts).toEqual([{ expected_version: 3, reason: 'Profile checked' }, { outcome: 'dispatched', expected_version: 2, note: 'Adapter reported dispatch' }]);
});

test('payee verification requires confirmation and removes the completed item', async ({ page }) => {
  let posts = 0;
  await mock(page, route => {
    if (route.request().method() === 'POST') { posts++; expect(route.request().postDataJSON()).toEqual({ verified: true }); return json(route, 201, { data: {} }); }
    return json(route, 200, { data: workbench(posts ? [] : [item('payee', payee)]) });
  });
  await page.goto(`${base}/ops`); const detail = await openOpsItem(page, 'payee');
  await detail.getByRole('button', { name: 'Verify payee' }).click(); expect(posts).toBe(0);
  await detail.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(detail).toHaveCount(0); await expect(page.locator('.metric-unverified strong')).toHaveText('0');
});

test('server pagination and student filtering reach items beyond the old cap', async ({ page }) => {
  const requests = [];
  await mock(page, route => {
    const params = new URL(route.request().url()).searchParams; requests.push(params.toString());
    const current = Number(params.get('page')) || 1, filtered = !!params.get('student');
    const total = filtered ? 1 : 125;
    const records = filtered ? [item('payee', { ...payee, owner_username: 'last-student', name: 'Last payee' })]
      : Array.from({ length: current === 7 ? 5 : 20 }, (_, i) => item('payee', { ...payee, id: id(100 + (current - 1) * 20 + i), name: `Payee ${(current - 1) * 20 + i + 1}` }));
    return json(route, 200, { data: workbench(records, { summary: { total, expiring: 0, unknown: 0, unverified: total, by_kind: { approvals: 0, transactions: 0, payees: total, loans: 0, sponsors: 0 } }, pagination: { page: current, page_size: 20, total, pages: filtered ? 1 : 7 } }) });
  });
  await page.goto(`${base}/ops`); await tasks(page);
  for (let pageNo = 2; pageNo <= 7; pageNo++) {
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText(`Page ${pageNo} of 7 · 125 items`)).toBeVisible();
  }
  await expect(page.getByText('Payee 125', { exact: true })).toBeVisible();
  await page.getByLabel('Student', { exact: true }).fill('last-student');
  await expect(page.getByText('Last payee', { exact: true })).toBeVisible();
  await expect(page.getByText('Page 1 of 1 · 1 items')).toBeVisible();
  expect(requests.some(value => value.includes('student=last-student'))).toBe(true);
});

test('approval chart drills into filtered recent records; empty state has no fake chart data', async ({ page }) => {
  await mock(page, route => json(route, 200, { data: workbench([], { recent_decisions: [{ ...approval, status: 'USED', decided_by_username: 'other-op', decision_note: 'Checked', decided_at: '2026-10-12T00:00:00Z' }] }) }));
  await page.goto(`${base}/ops`);
  await expect(page.locator('.metric-total strong')).toHaveText('0');
  await page.getByRole('button', { name: 'Used: 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Latest 20 approval records' })).toBeVisible();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('USED');
  await expect(page.getByText('Checked', { exact: true })).toBeVisible();
});
