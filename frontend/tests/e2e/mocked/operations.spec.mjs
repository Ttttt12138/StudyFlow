import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test.describe("operations console preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the queue read-only at phone width without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?ops=preview`);
    await page.getByRole("heading", { name: "Operations console" }).waitFor();
    const blocked = page.getByRole("article").filter({ hasText: "Help with family costs" });
    await blocked.getByText("You verified this payee, so another operator must decide.").waitFor();
    assert.equal(await blocked.getByRole("button", { name: "Approve" }).count(), 0);
    const open = page.getByRole("article").filter({ hasText: "Semester tuition payment" });
    assert.equal(await open.getByRole("button", { name: "Approve" }).isDisabled(), true);
    await page.getByRole("listitem", { name: "uat-student · rent" }).getByRole("button", { name: "Settled" }).waitFor();
    await page.getByLabel("Student", { exact: true }).fill("uat");
    assert.equal(await page.getByRole("listitem", { name: /demo-student/ }).count(), 0);
    assert.equal(await page.getByRole("article").count(), 0);
    await page.getByLabel("Student", { exact: true }).fill("");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("operations-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "运营台" }).waitFor();
    await blocked.getByText("该收款人由你核验，须由其他运营人员审批。").waitFor();
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("operations console with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("students see a staff-only message", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    await page.route("**/api/v2/**", route => json(route, 403, { detail: "Only operations staff can see the operations queue." }));
    await page.goto(`${base}/?ops=1`);
    await page.getByRole("heading", { name: "Operations staff only" }).waitFor();
    await page.getByText("This account is not an operator.").waitFor();
    await page.getByRole("link", { name: "Sign in as operator" }).waitFor();
  });

  test("approve needs a confirmation, a refused decision explains separation of duties and refreshes", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "op", csrf_token: "t" } }));
    const approval = { owner: 3, owner_username: "s1", id: "00000000-0000-4000-8000-000000000001", action: "payment.submit", target_id: "00000000-0000-4000-8000-000000000002",
      amount: "65000.00", currency: "THB", reason: "Tuition", status: "PENDING", version: 1, created_at: "2026-10-11T00:00:00Z",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), decided_at: null, decision_note: "", requested_by_username: "s1",
      decided_by_username: null, can_decide: true, blocked_reason: null, target: null };

    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        posts.push([path, request.postDataJSON()]);
        return json(route, 403, { detail: "SEPARATION_OF_DUTIES", code: "SEPARATION_OF_DUTIES", message: "Separation of duties." });
      }

      const blocked = posts.length > 0;
      return json(route, 200, { data: { operator: { id: 9, username: "op" }, approvals: [{ ...approval, can_decide: !blocked, blocked_reason: blocked ? "VERIFIED_PAYEE" : null }],
        recent_decisions: [], payments: [], remittance_orders: [], beneficiaries: [], is_simulated: true } });
    });
    await page.goto(`${base}/?ops=1`);
    const card = page.getByRole("article").filter({ hasText: "Tuition" });
    await card.getByLabel("Decision note (shown to the student)").fill("checked");
    await card.getByRole("button", { name: "Approve" }).click();
    await card.getByText("Approve THB 65,000.00 for s1? This releases an over-limit outflow.").waitFor();
    assert.equal(posts.length, 0);
    await card.getByRole("button", { name: "Confirm" }).click();
    await page.getByRole("alert").filter({ hasText: "Separation of duties: you cannot decide this request." }).waitFor();
    await card.getByText("You verified this payee, so another operator must decide.").waitFor();
    assert.deepEqual(posts, [[`approvals/${approval.id}/decide/`, { decision: "approve", note: "checked", expected_version: 1 }]]);
    assert.deepEqual(errors, []);
  });

  test("issues a sponsor link in the URL fragment, records money received and disburses a loan", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "op", csrf_token: "t" } }));
    const token = "ab".repeat(32);
    const sponsor = { owner: 3, owner_username: "s1", id: "00000000-0000-4000-8000-000000000030", status: "PENDING", terms_version: 2, purpose: "Tuition help",
      created_at: "2026-10-11T00:00:00Z", token_expires_at: null, confirmed_at: null,
      source: { id: "00000000-0000-4000-8000-000000000031", amount: "8000.00", currency: "THB", available_on: "2026-10-10", received: false } };
    const loan = { owner: 3, owner_username: "s1", id: "00000000-0000-4000-8000-000000000040", version: 3, status: "APPROVED", created_at: "2026-10-11T00:00:00Z",
      decision_reason: "", assessment: { status: "AFFORDABLE" }, quote: { currency: "THB", principal: "10000.00", net_proceeds: "9500.00", fees: "500.00",
        total_repayment: "10300.00", maximum_installment: "1720.00", months: 6, annual_rate: "0.12" } };
    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        posts.push([path, request.postDataJSON()]);
        if (path.endsWith("/issue-link/")) return json(route, 201, { data: { id: sponsor.id, terms_version: 2, expires_at: "2026-10-14T00:00:00Z", token, token_header: "X-Sponsor-Token" } });
        if (path.endsWith("/receive/")) return json(route, 201, { data: { id: sponsor.source.id, received: true } });
        if (path.endsWith("/disburse/")) return json(route, 201, { data: { application: { ...loan, status: "DISBURSED" }, account: { id: "acc" }, simulated: true } });
        return json(route, 404, { detail: path });
      }
      const confirmed = posts.some(([p]) => p.endsWith("/issue-link/"));
      return json(route, 200, { data: { operator: { id: 9, username: "op" }, approvals: [], recent_decisions: [], payments: [], remittance_orders: [], beneficiaries: [],
        applications: posts.some(([p]) => p.endsWith("/disburse/")) ? [] : [loan],
        sponsor_requests: [{ ...sponsor, status: confirmed ? "CONFIRMED" : "PENDING", token_expires_at: confirmed ? "2026-10-14T00:00:00Z" : null }], is_simulated: true } });
    });
    await page.goto(`${base}/?ops=1`);
    const request = page.getByRole("listitem", { name: "s1 · Tuition help" });
    await request.getByRole("button", { name: "Create confirmation link" }).click();
    await request.getByRole("button", { name: "Confirm" }).click();
    const link = request.getByLabel("Confirmation link");
    await link.waitFor();
    assert.equal(await link.inputValue(), `${base}/?sponsor=1#token=${token}`);
    await request.getByRole("button", { name: "Record money received" }).click();
    await request.getByRole("button", { name: "Confirm" }).click();
    await page.getByText("THB 8,000.00 recorded as received.").waitFor();
    const application = page.getByRole("listitem", { name: "s1 · loan application" });
    await application.getByRole("button", { name: "Disburse" }).click();
    await application.getByText(/Disburse THB 9,500\.00 to s1's simulated wallet/).waitFor();
    await application.getByRole("button", { name: "Confirm" }).click();
    await page.getByText("Disbursed. The student now has an active loan account.").waitFor();
    assert.deepEqual(posts, [
      [`sponsor-requests/${sponsor.id}/issue-link/`, { terms_version: 2 }],
      [`funding-sources/${sponsor.source.id}/receive/`, { hold_in_source_currency: false }],
      [`applications/${loan.id}/disburse/`, { expected_version: 3 }],
    ]);
    assert.deepEqual(errors, []);
  });
});
