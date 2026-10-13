import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";
import { enrolledPlanner } from "../plannerMock.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test.describe("payments preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("walks the preview statuses read-only at phone width without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?payments=preview`);
    await page.locator("#workspace-tool-title").getByText("Wallet & payments").waitFor();
    const detail = page.locator("#pay-detail");
    // A draft payment is in flight, so the panel opens on the Pay step.
    await detail.getByRole("heading", { name: /Authorize this payment/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Authorize", exact: true }).isDisabled(), true);
    await page.getByRole("tab", { name: "Due" }).click();
    await page.locator("#pay-bills li", { hasText: /Tuition · term 2.*Ready to pay/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Create payment" }).isDisabled(), true);
    const scenario = async (value) => {
      if (!(await page.getByLabel("Show payment as").isVisible())) await page.getByRole("button", { name: "More options" }).click();
      await page.getByLabel("Show payment as").selectOption(value);
    };
    await scenario("authorized");
    await page.getByRole("button", { name: "Submit payment" }).waitFor();
    await scenario("pending");
    await detail.getByText(/Waiting for the simulated adapter result/).waitFor();
    await scenario("reconciliation_exception");
    // An exception needs review elsewhere, so the panel opens on Due; the payment is one step over.
    await page.locator("#pay-bills").waitFor();
    await page.getByRole("tab", { name: "Pay", exact: true }).click();
    await detail.getByText("Does not match").waitFor();
    assert.equal(await detail.locator(".chart-steps .is-failed").count(), 1);
    await scenario("reconciled");
    // Nothing is in flight any more and term 2 is ready, so the panel goes back to Due.
    await page.locator("#pay-bills").waitFor();
    await page.getByRole("tab", { name: "Pay", exact: true }).click();
    await detail.getByText("Matched", { exact: true }).waitFor();
    await detail.getByRole("button", { name: /Audit trail/ }).click();
    await page.getByRole("dialog", { name: "Audit trail" }).locator(".pay-audit").getByText("Reconciled with invoice").waitFor();
    await page.keyboard.press("Escape");
    // Payments and transfers share one money tool: bill payments sit under History, next to orders and the ledger.
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByRole("button", { name: "Bill payments" }).click();
    await page.locator("#pay-history").getByText("Settled 1").waitFor();
    await page.getByRole("tab", { name: "Pay bills" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("payments-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.locator("#workspace-tool-title").getByText("钱包与付款", { exact: true }).waitFor();
    await detail.getByText("已支付并完成对账。").waitFor();
    await page.screenshot({ path: screenshot("payments-preview-mobile-zh.png"), fullPage: true });
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("payments with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("over-limit submit asks for an operator approval, then submits with a one-time password grant", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "test-csrf" } }));
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const page_ = results => ({ count: results.length, next: null, previous: null, results });
    const id = "00000000-0000-4000-8000-0000000000a1";
    const payment = { id, created_at: "2026-10-11T02:00:00Z", plan: null, readiness_plan: "r1", beneficiary: "b1", event_id: "cost:tuition:2026-10-15",
      amount: "80000.00", due_on: "2026-10-15", status: "authorized", authorized_until: new Date(Date.now() + 600_000).toISOString(),
      submitted_at: null, receipt: null, invoice_snapshot: { invoice_id: "INV-9", issuer: "Uni" }, is_simulated: true };
    let approval = null;
    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        posts.push(path);
        assert.ok(request.headers()["idempotency-key"]);
        if (path === `payments/${id}/submit/`) {
          if (!approval) return json(route, 403, { detail: "APPROVAL_REQUIRED", code: "APPROVAL_REQUIRED", message: "Operator approval required.", policy: { tier: "T3" } });
          if (request.headers()["x-step-up-token"] !== "one-time-grant") return json(route, 403, { detail: "STEP_UP_REQUIRED", code: "STEP_UP_REQUIRED", message: "Password required." });
          Object.assign(payment, { status: "pending", submitted_at: "2026-10-11T02:10:00Z" });
          return json(route, 201, { data: payment });
        }
        if (path === "approvals/") {
          const body = request.postDataJSON();
          assert.deepEqual({ ...body, reason: undefined }, { action: "payment.submit", target_id: id, amount: "80000.00", currency: "THB", reason: undefined });
          approval = { id: "ap1", action: "payment.submit", target_id: id, amount: "80000.00", currency: "THB", status: "APPROVED", expires_at: "2026-10-12T02:00:00Z", version: 2 };
          return json(route, 201, { data: approval });
        }
        if (path === "auth/step-up/") {
          const body = request.postDataJSON();
          assert.equal(body.password, "correct horse");
          assert.equal(body.action, "payment.submit");
          return json(route, 201, { data: { token: "one-time-grant" } });
        }
        return json(route, 500, { detail: `unexpected POST ${path}` });
      }
      if (path === "readiness/state/") return json(route, 200, { data: { state_version: 3, budget_version: 2, analysis_version: 1, semester_id: "s1",
        assets: { wallet_balance: "120000.00", currency: "THB", balance_as_of: "2026-10-11" },
        confirmed_obligations: [{ id: payment.event_id, label: "Tuition", kind: "expense", amount: "80000.00", date: "2026-10-15", certainty: "confirmed", beneficiary_id: "b1" }],
        estimated_expenses: [{ cost_id: "tuition", category: "tuition", invoice_id: "INV-9", issuer: "Uni", confidence_type: "VERIFIED" }] } });
      if (path === "readiness/funding-plans/") return json(route, 200, { data: [{ id: "r1", created_at: "2026-10-11T01:00:00Z", kind: "funding", state_version: 3, budget_version: 2, analysis_version: 1, result: { validation: "VALID" } }] });
      if (path === "beneficiaries/") return json(route, 200, page_([{ id: "b1", name: "Uni", destination_label: "MOCK", verified: true }]));
      if (path === "payments/") return json(route, 200, page_([payment]));
      if (path === "approvals/") return json(route, 200, page_(approval ? [approval] : []));
      if (path === "ledger/") return json(route, 200, page_([]));
      if (path === "audit/") return json(route, 500, { detail: "Injected audit failure" });
      return json(route, 404, { detail: path });
    });
    await enrolledPlanner(page);
    await page.goto(`${base}/?payments=1`);
    const detail = page.locator("#pay-detail");
    // An authorized payment is in flight, so the panel opens on the Pay step.
    await detail.getByRole("heading", { name: /Submit to the sandbox adapter/ }).waitFor();
    await page.getByRole("tab", { name: "Due" }).click();
    await page.locator("#pay-bills li", { hasText: /Tuition.*Payment in progress/ }).waitFor();
    await page.getByRole("tab", { name: "Pay", exact: true }).click();
    // The audit read failing does not hide the payment.
    await detail.getByRole("button", { name: /Audit trail/ }).click();
    await page.getByRole("dialog", { name: "Audit trail" }).getByText(/Injected audit failure/).waitFor();
    await page.getByRole("dialog", { name: "Audit trail" }).getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Submit payment" }).click();
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("heading", { name: /Operator approval needed/ }).waitFor();
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Request approval" }).click();
    await page.getByText(/Approval requested\. A second operator must decide/).waitFor();
    await detail.getByText("Approved", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Submit payment" }).click();
    await page.getByLabel("Password").fill("correct horse");
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Confirm and submit" }).click();
    await page.getByText("Payment submitted. Status: Submitted.").waitFor();
    assert.equal(await page.getByLabel("Password").count(), 0);
    assert.deepEqual(posts, [`payments/${id}/submit/`, "approvals/", "auth/step-up/", `payments/${id}/submit/`]);
    assert.deepEqual(errors, []);
  });
});
