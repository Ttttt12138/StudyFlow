import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test.describe("loans preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the sample loan lifecycle read-only at phone width without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?loans=preview`);
    await page.getByRole("heading", { name: "Your simulated applications" }).waitFor();
    const apps = page.locator("#loans-applications");
    await apps.getByText("Under review", { exact: true }).waitFor();
    await apps.getByText("Disbursed", { exact: true }).waitFor();
    await apps.getByText(/an operator reviews it/).waitFor();
    await apps.getByRole("link", { name: "Complete the affordability profile" }).waitFor();
    const accounts = page.locator("#loans-accounts");
    await accounts.getByRole("row", { name: /^1 .*Paid/ }).waitFor();
    await accounts.getByRole("row", { name: /^2 .*Due/ }).waitFor();
    assert.equal(await accounts.getByRole("button", { name: "Repay installment 2" }).isDisabled(), true);
    await page.locator("#loans-profile").getByText(/missing months: 2027-04/).waitFor();
    await page.locator("#loans-disbursements").getByText("Settled").waitFor();
    assert.equal(await page.getByRole("button", { name: "Create loan quote" }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("loans-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "你的模拟申请" }).waitFor();
    await page.getByRole("heading", { name: "放款记录" }).waitFor();
    await page.locator("#loans-accounts").getByText("按顺序", { exact: false }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("loans-preview-mobile-zh.png"), fullPage: true });
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("loans with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("submits a draft, repays with a password grant, then moves the demo clock", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const page_ = results => ({ count: results.length, next: null, previous: null, results });
    const rows = [1, 2, 3].map(n => ({ number: n, due_date: `2026-${String(9 + n).padStart(2, "0")}-15`, principal: "9900.00", interest: "275.73", amount: "10175.73", remaining_principal: "0.00" }));
    const quote = (id, months) => ({ id, created_at: "2026-10-01T00:00:00Z", engine_version: "b-monthly-amortization-v1",
      inputs: { currency: "THB", principal: "30000.00", annual_rate: "0.06", fees: "600.00", months, first_due_date: rows[0].due_date },
      result: { currency: "THB", principal: "30000.00", net_proceeds: "29400.00", fees: "600.00", total_interest: "527.19", total_repayment: "30527.19", repayments: rows, total_cost_over_net_proceeds: "1127.19" } });
    const draftQuote = { ...quote("q2", 3), inputs: { ...quote("q2", 3).inputs, first_due_date: "2027-01-15" },
      result: { ...quote("q2", 3).result, repayments: rows.map((r, n) => ({ ...r, due_date: `2027-0${n + 1}-15` })) } };
    const draft = { id: "00000000-0000-4000-8000-0000000000d1", created_at: "2026-11-01T00:00:00Z", version: 1, loan: "q2", status: "DRAFT", assessment: {}, decision_reason: "" };
    const accountId = "00000000-0000-4000-8000-0000000000c1";
    const account = { id: accountId, created_at: "2026-09-20T00:00:00Z", disbursement: "d1", status: "ACTIVE", version: 2, outstanding_principal: "20100.00",
      installments: rows.map((r, n) => ({ id: `i${n}`, number: r.number, due_on: r.due_date, amount: r.amount, principal: r.principal,
        paid_on: n === 0 ? r.due_date : null, status: ["PAID", "DUE", "SCHEDULED"][n] })) };
    const wallet = { id: "w1", clock: "2026-11-15", balance: "50000.00", available_balance: "50000.00" };
    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        posts.push(path);
        assert.ok(request.headers()["idempotency-key"]);
        if (path === `applications/${draft.id}/action/`) {
          assert.deepEqual(body, { expected_version: 1, action: "submit" });
          Object.assign(draft, { status: "UNDER_REVIEW", version: 2, assessment: { status: "INSUFFICIENT_DATA", missing_inputs: ["2027-03.income"], shortfall_months: [] } });
          return json(route, 201, { data: draft });
        }
        if (path === `loan-accounts/${accountId}/repay/`) {
          assert.deepEqual(body, { expected_version: 2, installment_number: 2 });
          if (request.headers()["x-step-up-token"] !== "one-time-grant") return json(route, 403, { detail: "STEP_UP_REQUIRED", code: "STEP_UP_REQUIRED", message: "Password required." });
          Object.assign(account, { version: 3, outstanding_principal: "10200.00" });
          Object.assign(account.installments[1], { paid_on: "2026-11-15", status: "PAID" });
          return json(route, 201, { data: { account, wallet, simulated: true } });
        }
        if (path === "auth/step-up/") {
          assert.deepEqual(body, { password: "correct horse", action: "loan.repay", target_id: accountId, amount: "10175.73", currency: "THB" });
          return json(route, 201, { data: { token: "one-time-grant" } });
        }
        if (path === "demo/clock/") {
          assert.deepEqual(body, { date: "2026-12-15" });
          wallet.clock = "2026-12-15";
          account.installments[2].status = "DUE";
          return json(route, 201, { data: wallet });
        }
        return json(route, 500, { detail: `unexpected POST ${path}` });
      }
      if (path === "applications/") return json(route, 200, page_([draft]));
      if (path === "loans/") return json(route, 200, page_([draftQuote, quote("q1", 3)]));
      if (path === "affordability-profile/") return json(route, 200, { data: { version: 0, months: [] } });
      if (path === "loan-accounts/") return json(route, 200, page_([account]));
      if (path === "disbursements/") return json(route, 500, { detail: "Injected disbursement failure" });
      if (path === "demo/wallets/") return json(route, 200, page_([wallet]));
      return json(route, 404, { detail: path });
    });
    await page.goto(`${base}/?loans=1`);
    const apps = page.locator("#loans-applications");
    await apps.getByText("Draft", { exact: true }).waitFor();
    // A failing disbursement list does not hide the other sections.
    await page.locator("#loans-disbursements").getByText(/Injected disbursement failure/).waitFor();

    const submit = apps.getByRole("button", { name: "Submit simulated application" });
    assert.equal(await submit.isDisabled(), true);
    await apps.getByLabel(/I understand this is a simulated application/).check();
    await submit.click();
    await page.getByText("Application submitted. Status: Under review.").waitFor();
    await apps.getByText(/an operator reviews it/).waitFor();

    const accounts = page.locator("#loans-accounts");
    const repay = accounts.getByRole("button", { name: "Repay installment 2" });
    assert.equal(await repay.isDisabled(), true);
    await accounts.getByLabel(/I confirm repaying/).check();
    await repay.click();
    await page.getByLabel("Password").fill("correct horse");
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByText(/Installment 2 repaid/).waitFor();
    assert.equal(await page.getByLabel("Password").count(), 0);

    // Installment 3 is not due yet: the repay button explains why and the demo clock offers its due date.
    await accounts.getByText(/Not due yet on the demo clock/).waitFor();
    const clock = page.locator("#loans-clock");
    const move = clock.getByRole("button", { name: /Move demo date to/ });
    assert.equal(await move.isDisabled(), true);
    await clock.getByLabel(/changes the simulated date/).check();
    await move.click();
    await page.getByText(/Demo date moved to/).waitFor();
    await accounts.getByRole("button", { name: "Repay installment 3" }).waitFor();

    assert.deepEqual(posts, [`applications/${draft.id}/action/`, `loan-accounts/${accountId}/repay/`, "auth/step-up/", `loan-accounts/${accountId}/repay/`, "demo/clock/"]);
    assert.deepEqual(errors, []);
  });
});
