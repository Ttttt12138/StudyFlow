import { test, expect } from "@playwright/test";
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
  return { id, kind: "tuition", label: typeof label === "string" ? { en: label, zh: label } : label,
    due_date: "2026-11-01", amount, currency, status: "DUE", paid_at: null, paid_by_loan: false };
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

  for (const [width, height, expanded] of [[320, 740, false], [390, 844, false], [1440, 900, false], [1440, 900, true]]) {
    test(`all bill details remain reachable at ${width}x${height}${expanded ? " expanded" : ""}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const rows = Array.from({ length: 10 }, (_, index) => ({
        ...bill(`tuition-${index}`, { en: `Semester ${index + 1} tuition`, zh: `第 ${index + 1} 学期学费` }, "41000.00"),
        loan_pending: { amount: index === 9 ? "9000.00" : "41000.00", status: "APPROVED" },
      }));
      rows.push({ ...bill("housing", { en: "Housing deposit", zh: "住宿押金" }, "90000.00"), kind: "housing" });
      const posts = await wallet(page, { bills: rows, balance: { value: "7000.00" },
        commands: route => json(route, 500, { detail: "No payment should be submitted" }) });
      await page.goto(`${base}/?tool=wallet&section=pay`);
      if (expanded) await page.getByRole("button", { name: "Expand tool", exact: true }).click();
      const pay = page.locator(".plan-bills-pay").first();
      for (const language of ["English", "中文"]) {
        await page.getByRole("button", { name: language, exact: true }).click();
        await pay.evaluate(node => node.scrollTo({ top: 0 }));
        await expect(pay.getByRole("heading", { name: language === "English" ? "Plan bills" : "方案账单", exact: true })).toBeInViewport({ ratio: 1 });
        // The loan's nine direct payments fold into one line; the partly covered tenth bill is listed with the family's part.
        await expect(pay.locator(".bill-loan > summary")).toContainText(language === "English" ? "9 bill(s)" : "9 笔");
        if (!await pay.locator(".bill-loan").evaluate(node => node.open)) await pay.locator(".bill-loan > summary").click();
        const last = pay.locator(".bill-loan .bill-rows li").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport({ ratio: 0.99 });
        expect(await pay.evaluate(node => node.scrollTop > 0)).toBe(true);
        expect(await page.locator(".tool-content[data-tool=wallet]").evaluate(node =>
          node.scrollTop === 0 && node.scrollHeight <= node.clientHeight + 1)).toBe(true);
        const name = `bill-layout-${width}-${expanded ? "expanded" : "dock"}-${language === "English" ? "en" : "zh"}`;
        await page.locator(".workspace-dock").screenshot({ path: screenshot(`${name}-last.png`) });
        const housing = pay.locator(".bill-rows li", { hasText: language === "English" ? "Housing deposit" : "住宿押金" });
        await housing.getByRole("button", { name: language === "English" ? "Top up" : "充值", exact: true }).click();
        const amount = housing.getByLabel(language === "English" ? "Amount (THB)" : "金额（THB）", { exact: true });
        await expect(amount).toHaveValue("83000.00");
        const cancel = housing.getByRole("button", { name: language === "English" ? "Cancel" : "取消", exact: true });
        await cancel.scrollIntoViewIfNeeded();
        await expect(cancel).toBeInViewport({ ratio: 0.99 });
        expect(await pay.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.locator(".workspace-dock").screenshot({ path: screenshot(`${name}-topup.png`) });
        await cancel.click();
      }
      expect(posts).toEqual([]);
    });
  }

  for (const [status, amount] of [["APPROVED", "41000.00"], ["UNDER_REVIEW", "41000.00"], ["APPROVED", "9000.00"]]) test(`unsigned ${status} loan funds ${amount} of tuition directly`, async ({ page }) => {
    const tuition = { ...bill("00000000-0000-4000-8000-0000000000c1", "Tuition per semester", "41000.00"),
      loan_pending: { amount, status } };
    const rows = [tuition, { ...bill("00000000-0000-4000-8000-0000000000c2", "Insurance", "2000.00"), kind: "insurance" }];
    const posts = await wallet(page, { bills: rows, balance: { value: "60000.00" },
      commands: route => json(route, 500, { detail: "No payment should be submitted" }) });
    await page.goto(`${base}/?tool=wallet&section=pay`);
    const pay = page.locator(".plan-bills-pay").first();
    await expect(pay.getByRole("button", { name: "Continue loan application", exact: true })).toBeVisible();
    await expect(pay).toContainText(status === "APPROVED" ? "Loan approved" : "under review");
    // Tuition is listed once: in full under the loan's payments, or with the family's remainder when the loan covers part.
    await expect(pay.locator(".bill-rows li", { hasText: "Tuition per semester" })).toHaveCount(1);
    if (amount === "9000.00") {
      const row = pay.locator(".bill-section").first().locator(".bill-rows li", { hasText: "Tuition per semester" });
      await expect(row).toContainText("Total THB 41,000.00 · the loan pays THB 9,000.00");
      await expect(row).toContainText("THB 32,000.00");
      await expect(row).toContainText("Payable after signing");
      await expect(row.getByRole("button", { name: "Pay from wallet", exact: true })).toHaveCount(0);
    } else {
      // The loan's state is said once, on the folded line; each row only names the bill.
      await expect(pay.locator(".bill-loan > summary")).toContainText(status === "APPROVED" ? "awaiting documents and signing" : "awaiting loan approval/signing");
      await pay.locator(".bill-loan > summary").click();
      await expect(pay.locator(".bill-loan .bill-rows li", { hasText: "Tuition per semester" })).toContainText("THB 41,000.00");
    }
    const insurance = pay.locator(".bill-rows li", { hasText: "Insurance" });
    await expect(insurance.getByRole("button", { name: "Pay from wallet", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "中文", exact: true }).click();
    await expect(pay.getByRole("button", { name: "继续贷款流程", exact: true })).toBeVisible();
    await page.locator(".workspace-dock").screenshot({ path: screenshot(`tuition-loan-${status.toLowerCase()}-${amount}-390-zh.png`) });
    expect(posts).toEqual([]);
  });

  test("a bill the signed loan partly pays is listed once, with the family's part to pay", async ({ page }) => {
    const insurance = { ...bill("00000000-0000-4000-8000-0000000000d1", "Student insurance", "2300.00"), kind: "insurance",
      due_date: "2029-08-09", group: "insurance:y3" };
    const rows = [insurance,
      { ...insurance, id: "00000000-0000-4000-8000-0000000000d2", amount: "4700.00", paid_by_loan: true },
      { ...bill("00000000-0000-4000-8000-0000000000d3", "Tuition per semester", "41000.00"), paid_by_loan: true, due_date: "2029-08-09" },
      { ...bill("00000000-0000-4000-8000-0000000000d4", "Tuition per semester", "41000.00"), paid_by_loan: true, status: "PAID", due_date: "2027-08-09" },
      { ...bill("00000000-0000-4000-8000-0000000000d5", "Visa", "2000.00"), kind: "visa", status: "PAID", due_date: "2027-08-09" }];
    const posts = await wallet(page, { bills: rows, balance: { value: "58382.35" },
      commands: route => json(route, 500, { detail: "No payment should be submitted" }) });
    await page.goto(`${base}/?tool=wallet&section=pay`);
    const pay = page.locator(".plan-bills-pay").first();
    await expect(pay.locator(".bill-summary")).toContainText("THB 2,300.00");
    await expect(pay.locator(".bill-summary")).toContainText("THB 41,000.00");
    const own = pay.locator(".bill-section").first().locator(".bill-rows li");
    await expect(own).toHaveCount(1);
    await expect(own).toContainText("Total THB 7,000.00 · the loan pays THB 4,700.00");
    await expect(own.getByRole("button", { name: "Pay from wallet", exact: true })).toBeEnabled();
    // Paid bills are in the records, not on the pay tab; the loan's payments are folded until opened.
    await expect(pay.getByText("Visa")).toHaveCount(0);
    await expect(pay.locator(".bill-loan")).not.toHaveAttribute("open", "");
    await pay.locator(".bill-loan > summary").click();
    await expect(pay.locator(".bill-loan .bill-rows li")).toHaveCount(1);
    await expect(pay.locator(".bill-rows li", { hasText: "Student insurance" })).toHaveCount(1);
    await page.getByRole("button", { name: "中文", exact: true }).click();
    await page.locator(".workspace-dock").screenshot({ path: screenshot("wallet-bill-split-390-zh.png") });
    await page.getByRole("button", { name: "English", exact: true }).click();
    await pay.getByRole("button", { name: "View records", exact: true }).click();
    const records = page.locator(".plan-bills-pay").filter({ hasText: "Bill payments" });
    await expect(records.locator(".bill-rows li")).toHaveCount(2);
    await expect(records).toContainText("paid from the wallet");
    expect(posts).toEqual([]);
  });

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
    const row = pay.locator(".bill-rows li", { hasText: "Tuition per semester" });
    await pay.getByText("Wallet available THB 7,000.00").waitFor();
    await pay.getByText("The wallet is THB 34,000.00 short of everything listed").waitFor();
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
    const row = page.locator(".bill-rows li", { hasText: "Housing deposit" });
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
    await pay.getByRole("alert").filter({ hasText: "The school's tuition account is not verified" }).waitFor();
    const tuition = pay.locator(".bill-rows li", { hasText: "Tuition per semester" });
    assert.equal(await tuition.getByRole("button", { name: "Awaiting verification" }).isDisabled(), true);
    assert.equal(await tuition.getByRole("button", { name: "Pay from wallet" }).count(), 0);
    const visa = pay.locator(".bill-rows li", { hasText: "Student visa" });
    assert.equal(await visa.getByRole("button", { name: "Pay from wallet" }).isEnabled(), true);
    await page.screenshot({ path: screenshot("wallet-bill-school-unverified-390.png") });
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
  });
});
