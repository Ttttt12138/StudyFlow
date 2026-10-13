// Real Django/PostgreSQL with the rule planner (STUDYFLOW_MODE=mock); disposable users.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backend, python, screenshot } from '../../support.mjs';

const shell = (code, env = {}) => execFileSync(python, ['manage.py', 'shell', '-c', code],
  { cwd: backend, env: { ...process.env, ...env }, stdio: 'pipe' }).toString();

test('real Django planner: parent plans a school with a loan, enrolls three days before start, records spending, links the student', async ({ browser }) => {
  const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
  const names = { parent: `plan-parent-${randomUUID()}`, student: `plan-student-${randomUUID()}`, operator: `plan-operator-${randomUUID()}` };
  const passwords = { parent: randomUUID(), student: randomUUID(), operator: randomUUID() };
  shell('import os,json; from django.contrib.auth import get_user_model; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k=="operator") for k,n in names.items()]',
    { UAT_NAMES: JSON.stringify(names), UAT_PASSWORDS: JSON.stringify(passwords) });
  const errors = [];
  const contexts = {};
  async function login(kind, next = '/') {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    contexts[kind] = context;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin + next)}`);
    await page.getByLabel('Username').fill(names[kind]);
    await page.getByLabel('Password').fill(passwords[kind]);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    return page;
  }
  async function post(kind, path, body, headers = {}) {
    const identity = await (await contexts[kind].request.get(`${origin}/api/auth/session/`)).json();
    const response = await contexts[kind].request.post(`${origin}/api/v2/${path}`,
      { data: body, headers: { 'X-CSRFToken': identity.csrf_token, 'Idempotency-Key': randomUUID(), ...headers } });
    assert.ok([200, 201].includes(response.status()), `${path}: ${await response.text()}`);
    return (await response.json()).data;
  }

  try {
    const page = await login('parent');
    const chat = page.locator('#plan-chat');
    const say = async (text, expect) => {
      await chat.getByLabel('Message the assistant').fill(text);
      await chat.getByLabel('Message the assistant').press('Enter');
      await chat.getByText(expect, { exact: false }).last().waitFor();
    };
    // The first screen leads with the price question; nobody is asked whether they are a parent or the student.
    await chat.getByRole('heading', { name: 'Know what studying abroad costs before you go' }).waitFor();
    await say('What does 4 years at Chulalongkorn cost in total?', '4 year(s) total about');
    await say('We have savings of 200000 CNY, choose Chulalongkorn', 'Funding gap about');
    await page.getByRole('button', { name: 'My plan', exact: true }).click();
    await page.locator('#plan-summary').getByText('Draft').waitFor();
    await say('Simulate a loan over 48 months', 'Simulated loan: principal');
    await page.locator('#plan-summary').getByRole('heading', { name: 'Simulated loan' }).waitFor();
    await say('Confirm the plan', 'A plan confirmation is ready');
    await chat.locator('.plan-card-confirm').last().getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review and confirm' }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('button', { name: 'My plan', exact: true }).click();
    await page.getByText('Done. The plan is updated.').waitFor();
    await page.locator('#plan-summary').getByText('Confirmed').waitFor();
    await chat.getByText("Let's start preparing for enrollment.", { exact: false }).waitFor();
    await page.locator('#plan-journey-guide').getByRole('button', { name: 'Departure preparation' }).click();
    await chat.getByText('Do you have an offer', { exact: false }).waitFor();

    // Three days before classes the assistant speaks first and proposes enrollment.
    shell('import os; from datetime import date, timedelta; from finance.planning.models import StudyPlan; p=StudyPlan.objects.get(owner__username=os.environ["UAT_PARENT"]); p.start_date=date.today()+timedelta(days=3); p.save(update_fields=["start_date"])',
      { UAT_PARENT: names.parent });
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'New price question' }).click();
    await chat.getByText('Classes start in 3 day(s).', { exact: false }).waitFor();
    await page.locator('#plan-journey-guide').getByRole('button', { name: 'Still preparing' }).click();
    await chat.getByText('I will not confirm enrollment', { exact: false }).waitFor();
    await page.locator('#plan-summary').getByText('Confirmed').waitFor();
    await page.locator('#plan-journey-guide').getByRole('button', { name: 'Registration completed' }).click();
    await page.getByRole('dialog', { name: 'Review and confirm' }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.locator('#plan-summary').getByText('Enrolled').waitFor();
    // Enrolled: the sidebar gains the life tools.
    await page.locator('.workspace-stage').getByText('Enrolled').waitFor();
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Wallet & payments' }).waitFor();
    await chat.getByText("let's settle into daily life", { exact: false }).waitFor();
    await page.locator('#plan-journey-guide').getByRole('button', { name: 'Campus life', exact: true }).click();
    await chat.locator('.workspace-card-summary').getByRole('heading', { name: 'Chulalongkorn University' }).last().waitFor();
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Bills & expenses', exact: true }).click();
    const school = page.locator('#plan-school');
    await school.getByRole('heading', { name: 'Upcoming bills' }).waitFor();
    // Bills page four at a time; step through the pages until the first loan installment shows.
    for (let n = 0; n < 6 && !(await school.getByText('Loan installment 1').count()); n++) await school.getByRole('button', { name: 'Next', exact: true }).click();
    await school.getByText('Loan installment 1').first().waitFor();
    await say('I spent 120 THB on lunch today', 'Recorded:');
    await school.getByRole('tab', { name: 'This month' }).click();
    await school.getByText('120 THB').first().waitFor();
    await page.screenshot({ path: screenshot('plan-integration-in-school.png'), fullPage: true });
    await say('How much have I spent this month?', '120');
    const monthly = page.locator('.monthly-report');
    await monthly.getByRole('img', { name: 'Spending by category' }).waitFor();
    await monthly.locator('.monthly-legend').getByText('100%', { exact: true }).waitFor();
    await monthly.getByRole('tab', { name: /^Entries/ }).click();
    await monthly.locator('.monthly-entries').getByText('120.00 THB').waitFor();
    await page.screenshot({ path: screenshot('plan-integration-monthly.png'), fullPage: true });

    // The student asks for support; the operator issues the link; the parent confirms it, then links accounts.
    await login('student', '/?family=1');
    const request = await post('student', 'sponsor-requests/', { economic_key: `fam-${randomUUID()}`, currency: 'CNY',
      amount: '50000.00', available_on: '2027-07-01', purpose: 'Tuition support' });
    await login('operator', '/?ops=1');
    const link = await post('operator', `sponsor-requests/${request.id}/issue-link/`, { terms_version: request.terms_version });
    const confirmed = await contexts.parent.request.post(`${origin}/api/v2/sponsor-confirmation/`, {
      data: { decision: 'confirm', terms_version: request.terms_version },
      headers: { 'X-Sponsor-Token': link.token, 'Idempotency-Key': randomUUID() } });
    assert.equal(confirmed.status(), 200, await confirmed.text());
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Settings' }).click();
    await page.locator('#side-settings').getByRole('button', { name: 'Link a family account' }).click();
    const family = page.locator('#plan-family');
    await family.getByLabel('Sponsor link token').fill(link.token);
    await family.getByRole('button', { name: 'Link accounts' }).click();
    await page.getByText('Accounts linked.').waitFor();
    await family.getByText(`Student account ${names.student}`).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all(Object.values(contexts).map(context => context.close()));
  }
});
