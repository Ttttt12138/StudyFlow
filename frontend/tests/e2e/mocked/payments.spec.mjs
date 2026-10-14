import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";
import { enrolledPlanner } from "../plannerMock.mjs";

// The wallet's Pay tab pays the plan's bills from the simulated wallet (src/wallet/PlanBillsPay.tsx): a short bill is
// topped up or exchanged first, every payment is confirmed with the password (T2), and an over-limit one first goes
// to operations (T3) — in the demo a simulated operator approves it after a countdown.
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const page_ = results => ({ count: results.length, next: null, previous: null, results });
const denied = code => ({ detail: code, code, message: code, policy: { tier: code === "APPROVAL_REQUIRED" ? "T3" : "T2" } });

function bill(id, label, amount, currency = "THB") {
  return { id, kind: "tuition", label: { en: label, zh: label }, due_date: "2026-11-01", amount, currency, status: "DUE", paid_at: null, paid_by_loan: false };
}

const SCHOOL = { id: "00000000-0000-4000-8000-0000000000a1", name: "Prince of Songkla University, Phuket Campus",
  account: "Tuition account (simulated)", verified: true };

/** Mocked Django for the money hub: balances, bills and the commands of one test, recorded in `posts`. */
async function wallet(page, { bills, balance, commands, payee = SCHOOL }) {
  const posts = [];
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "test-csrf" } }));
  await page.route("**/api/v2/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/.*\/api\/v2\//, "");
    if (request.method() === "POST") {
      assert.ok(request.headers()["idempotency-key"], path);
      posts.push(path);
      return commands(route, path, request);
    }
    if (path === "planning/wallet-bills/") return json(route, 200, { data: { bills, school_payee: payee, is_simulated: true } });
    if (path === "demo/wallets/balances/") return json(route, 200, { data: { home_currency: "THB", is_simulated: true, supported_currencies: ["THB", "CNY", "USD"],
      balances: [{ currency: "THB", balance: balance.value, available_balance: balance.value, is_home: true, indicative_home_value: balance.value, valuation: null }] } });
    if (["beneficiaries/", "remittance-orders/", "approvals/", "ledger/", "conversions/"].includes(path)) return json(route, 200, page_([]));
    if (path === "corridors/") return json(route, 200, { data: [] });
    return json(route, 404, { detail: path });
  });
  await enrolledPlanner(page);
  return posts;
}

test.describe("wallet bill payments", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a short bill is topped up in place, then paid after the password", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const rows = [bill("00000000-0000-4000-8000-0000000000b1", "Tuition per semester", "41000.00")];
    const balance = { value: "7000.00" };
    const posts = await wallet(page, { bills: rows, balance, commands: (route, path, request) => {
      if (path === "demo/wallets/top-up/") {
        assert.deepEqual(request.postDataJSON(), { currency: "THB", amount: "34000.00" });
        balance.value = "41000.00";
        return json(route, 201, { data: { id: "t1", currency: "THB", amount: "34000.00", balance: "41000.00", is_simulated: true } });
      }
      if (path === "auth/step-up/") {
        const body = request.postDataJSON();
        assert.deepEqual({ ...body, password: undefined }, { action: "bill.pay", target_id: rows[0].id, amount: "41000.00", currency: "THB", password: undefined });
        assert.equal(body.password, "correct horse");
        return json(route, 200, { token: "one-time-grant" });
      }
      if (path === `planning/bills/${rows[0].id}/pay-from-wallet/`) {
        if (request.headers()["x-step-up-token"] !== "one-time-grant") return json(route, 403, denied("STEP_UP_REQUIRED"));
        Object.assign(rows[0], { status: "PAID", paid_at: "2026-10-14" });
        balance.value = "0.00";
        return json(route, 201, { data: { bill: rows[0], balance: "0.00", currency: "THB", is_simulated: true } });
      }
      return json(route, 500, { detail: `unexpected POST ${path}` });
    } });
    await page.goto(`${base}/?tool=wallet&section=pay`);
    const pay = page.locator(".plan-bills-pay").first();
    const row = pay.locator(".plan-bills-list li", { hasText: "Tuition per semester" });
    await row.getByText("Wallet: THB 7,000.00").waitFor();
    // Short of 34,000: "Top up" opens a form in the row with the missing amount filled in.
    await row.getByRole("button", { name: "Top up", exact: true }).click();
    assert.equal(await row.getByLabel("Amount (THB)").inputValue(), "34000.00");
    await page.screenshot({ path: screenshot("wallet-bill-top-up-390.png") });
    await row.getByRole("button", { name: "Top up THB 34,000.00", exact: true }).click();
    await pay.getByText("Topped up THB 34,000.00. You can now pay Tuition per semester.").waitFor();
    await row.getByRole("button", { name: "Pay from wallet" }).click();
    const dialog = page.getByRole("dialog", { name: "Review and confirm" });
    await dialog.getByRole("heading", { name: /Confirm with your password/ }).waitFor();
    await dialog.getByLabel("Password").fill("correct horse");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await pay.getByText("Paid Tuition per semester: THB 41,000.00 (simulated).").waitFor();
    await pay.getByText("Everything due is paid.").waitFor();
    assert.deepEqual(posts, ["demo/wallets/top-up/", `planning/bills/${rows[0].id}/pay-from-wallet/`, "auth/step-up/", `planning/bills/${rows[0].id}/pay-from-wallet/`]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  });

  test("an over-limit bill waits for the simulated operator, then the password finishes it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const rows = [bill("00000000-0000-4000-8000-0000000000b2", "Housing deposit", "90000.00")];
    let approval = null;
    const posts = await wallet(page, { bills: rows, balance: { value: "120000.00" }, commands: (route, path, request) => {
      if (path === `planning/bills/${rows[0].id}/pay-from-wallet/`) {
        if (approval?.status !== "APPROVED") return json(route, 403, denied("APPROVAL_REQUIRED"));
        if (request.headers()["x-step-up-token"] !== "one-time-grant") return json(route, 403, denied("STEP_UP_REQUIRED"));
        rows[0].status = "PAID";
        return json(route, 201, { data: { bill: rows[0], balance: "30000.00", currency: "THB", is_simulated: true } });
      }
      if (path === "approvals/") {
        // The explanation is optional: an empty one is sent as "".
        assert.deepEqual(request.postDataJSON(), { action: "bill.pay", target_id: rows[0].id, amount: "90000.00", currency: "THB", reason: "" });
        approval = { id: "ap1", status: "PENDING", simulated_after_seconds: 2, created_at: new Date().toISOString() };
        return json(route, 201, { data: approval });
      }
      if (path === "approvals/ap1/simulate/") {
        approval.status = "APPROVED";
        return json(route, 200, { data: approval });
      }
      if (path === "auth/step-up/") return json(route, 200, { token: "one-time-grant" });
      return json(route, 500, { detail: `unexpected POST ${path}` });
    } });
    await page.goto(`${base}/?tool=wallet&section=pay`);
    const row = page.locator(".plan-bills-list li", { hasText: "Housing deposit" });
    await row.getByRole("button", { name: "Pay from wallet" }).click();
    const dialog = page.getByRole("dialog", { name: "Review and confirm" });
    await dialog.getByRole("heading", { name: /Operator approval needed/ }).waitFor();
    await dialog.getByRole("button", { name: "Request approval" }).click();
    await dialog.getByText("Approval requested. An operator may contact you to confirm the details of this payment.").waitFor();
    await dialog.getByText(/Simulated approval in \d s/).waitFor();
    await page.screenshot({ path: screenshot("wallet-bill-approval-countdown-390.png") });
    // After the countdown the simulated operator approves and the password step takes over.
    await dialog.getByRole("heading", { name: /Confirm with your password/ }).waitFor({ timeout: 10_000 });
    await dialog.getByText("Approved by operations (simulated). Confirm with your password to finish.").waitFor();
    await dialog.getByLabel("Password").fill("correct horse");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByText("Paid Housing deposit: THB 90,000.00 (simulated).").waitFor();
    assert.deepEqual(posts, [`planning/bills/${rows[0].id}/pay-from-wallet/`, "approvals/", "approvals/ap1/simulate/", "auth/step-up/",
      `planning/bills/${rows[0].id}/pay-from-wallet/`]);
    assert.deepEqual(errors, []);
  });

  test("tuition waits while the school's account is not verified; other bills can still be paid", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const rows = [bill("00000000-0000-4000-8000-0000000000b3", "Tuition per semester", "41000.00"),
      { ...bill("00000000-0000-4000-8000-0000000000b4", "Student visa", "2000.00"), kind: "visa" }];
    const posts = await wallet(page, { bills: rows, balance: { value: "60000.00" }, payee: { ...SCHOOL, verified: false },
      commands: (route, path) => json(route, 500, { detail: `unexpected POST ${path}` }) });
    await page.goto(`${base}/?tool=wallet&section=pay`);
    const pay = page.locator(".plan-bills-pay").first();
    await pay.getByText("Tuition goes to Prince of Songkla University, Phuket Campus · Tuition account (simulated)").waitFor();
    await pay.getByRole("alert").filter({ hasText: "The school's tuition account is not verified" }).waitFor();
    const tuition = pay.locator(".plan-bills-list li", { hasText: "Tuition per semester" });
    assert.equal(await tuition.getByRole("button", { name: "Awaiting verification" }).isDisabled(), true);
    assert.equal(await tuition.getByRole("button", { name: "Pay from wallet" }).count(), 0);
    const visa = pay.locator(".plan-bills-list li", { hasText: "Student visa" });
    assert.equal(await visa.getByRole("button", { name: "Pay from wallet" }).isEnabled(), true);
    await page.screenshot({ path: screenshot("wallet-bill-school-unverified-390.png") });
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
  });
});
