import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

test.describe("wallet preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows every preview status read-only, without calling Django, at phone width", async ({ page: preview }) => {
    const errors = [];
    let previewCalls = 0;
    preview.on("pageerror", error => errors.push(error.message));
    await preview.route("**/api/v2/**", route => { previewCalls++; return route.abort(); });
    await preview.goto(`${base}/?wallet=preview`);
    await preview.getByRole("heading", { name: "Wallet & transfers" }).waitFor();
    await preview.reload();
    await preview.getByRole("heading", { name: "Wallet & transfers" }).waitFor();
    await preview.getByText("THB 52,500.00").first().waitFor();
    // Remittance routes and the current order live on the remit tab.
    await preview.getByRole("tab", { name: "Remit" }).click();
    assert.match(await preview.locator(".tool-content[data-tool=wallet]").innerText(), /Fixture-priced demo route/);
    assert.equal(await preview.getByRole("button", { name: "Get backend quotes" }).isDisabled(), true);
    await preview.getByRole("button", { name: /^Current order/ }).click();
    await preview.getByLabel("Preview a status").selectOption("refunded");
    await preview.getByText("The backend reports a failed transfer and a refund.").waitFor();
    await preview.getByLabel("Preview a status").selectOption("unknown");
    await preview.getByText("The backend cannot confirm the outcome yet.", { exact: false }).waitFor();
    await preview.getByLabel("Preview a status").selectOption("expired");
    await preview.getByText("The quote expired. Prepare a new transfer with a fresh quote.").waitFor();
    await preview.getByLabel("Preview a status").selectOption("empty");
    await preview.getByRole("tab", { name: "History" }).click();
    await preview.getByText("No simulated remittances have been created for this student.").waitFor();
    assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await preview.screenshot({ path: screenshot('wallet-preview-mobile.png'), fullPage: true });
    assert.equal(previewCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("wallet with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("session/CSRF quotes, stale quotes, beneficiary gate, approval, step-up, lost response and reload", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.context().addCookies([{ name: "csrftoken", value: "test-csrf", url: base }]);
    await page.route("**/api/auth/session/",route=>route.fulfill({json:{authenticated:true,username:"student",csrf_token:"test-csrf"}}));
    const calls = [];
    const balances = { home_currency: "THB", is_simulated: true, balances: [{ currency: "USD", balance: "800.00", available_balance: "800.00", is_home: false, indicative_home_value: "26400.00", valuation: null }] };
    const corridors = [
      { id: "route-one", code: "usd-thb-one", provider: "Mock route", tier: "standard", source_currency: "USD", target_currency: "THB", min_amount: "10.00", max_amount: "1500.00", settlement_min_days: 2, settlement_days: 4, is_simulated: true },
      { id: "route-two", code: "usd-thb-two", provider: "Mock route", tier: "express", source_currency: "USD", target_currency: "THB", min_amount: "10.00", max_amount: "1500.00", settlement_min_days: 0, settlement_days: 1, is_simulated: true },
    ];
    const beneficiaries = [{ id: "school-one", name: "Example University", destination_label: "Tuition", verified: true }, { id: "housing-one", name: "Housing", destination_label: "Housing", verified: false }];
    let order = null, approval = null, quoteCalls = 0, createCalls = 0, submitCalls = 0, stepUpCalls = 0, operatorApproved = false;
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      const method = request.method();
      const body = method === "POST" ? request.postDataJSON() : null;
      calls.push({ path, method, body, headers: request.headers() });
      if (method === "POST") {
        assert.equal(request.headers()["x-csrftoken"], "test-csrf");
        assert.ok(request.headers()["idempotency-key"]);
      }
      if (path === "demo/wallets/balances/" && method === "GET") return json(route, 200, { data: balances });
      if (path === "corridors/" && method === "GET") return json(route, 200, { data: corridors });
      if (path === "beneficiaries/" && method === "GET") { const second = new URL(request.url()).searchParams.get("page") === "2"; return json(route, 200, { count: 2, results: second ? beneficiaries.slice(1) : beneficiaries.slice(0,1), next: second ? null : `${base}/api/v2/beneficiaries/?page=2` }); }
      if (path === "remittance-orders/" && method === "GET") return json(route, 200, { count: order ? 1 : 0, results: order ? [order] : [] });
      if (path === "approvals/" && method === "GET") {
        if (approval && operatorApproved) approval.status = "APPROVED";
        return json(route, 200, { count: approval ? 1 : 0, results: approval ? [approval] : [] });
      }
      if (path.startsWith("remittance-orders/") && method === "GET") return json(route, 200, { data: order });
      if (path === "fx-quotes/live/" && method === "POST") {
        quoteCalls++;
        return json(route, 201, { data: { id: `quote-${quoteCalls}`, corridor_id: body.corridor_id, route_name: `Mock ${body.corridor_id}`, source_currency: "USD", target_currency: "THB", send_amount: body.send_amount, net_received: quoteCalls === 1 ? "6500.00" : "6460.00", rate: "33.0000000000", sender_fee: "2.00", receiver_fee: "0.00", settlement_min_days: 0, settlement_days: 2, expires_at: inOneHour(), rate_source: "fixture", rate_date: "2026-10-09", is_mock: true } });
      }
      if (path === "remittance-orders/" && method === "POST") {
        createCalls++;
        assert.equal(body.recipient, "BENEFICIARY");
        assert.equal(body.beneficiary_id, "school-one");
        order = { id: "order-one", version: 1, quote: body.quote_id, status: "CREATED", effective_status: "CREATED", recipient: "BENEFICIARY", beneficiary: "school-one", purpose: body.purpose, reference: body.reference, send_currency: "USD", send_amount: "200.00", sender_fee: "2.00", receive_currency: "THB", receive_amount: "6500.00", rate: "33.0000000000", total_cost: "3.00", expected_earliest: "2026-10-11", expected_latest: "2026-10-13", deadline: body.deadline, submitted_at: null, delivered_on: null, failure_reason: "", history: [{ from: "", to: "CREATED", version: 1, at: "2026-10-09T00:00:00Z", note: "" }], is_simulated: true };
        return json(route, 201, { data: order });
      }
      if (path === "remittance-orders/order-one/submit/" && method === "POST") {
        submitCalls++;
        if (!approval) return json(route, 403, { detail: "APPROVAL_REQUIRED", policy: { tier: "T3", requires: ["approval"] } });
        if (!request.headers()["x-step-up-token"]) return json(route, 403, { detail: "STEP_UP_REQUIRED", policy: { tier: "T3", requires: ["step_up"] } });
        assert.equal(request.headers()["x-step-up-token"], "ephemeral-grant");
        order = { ...order, status: "SUBMITTED", effective_status: "SUBMITTED", version: 2, submitted_at: "2026-10-09T01:00:00Z", history: [...order.history, { from: "CREATED", to: "SUBMITTED", version: 2, at: "2026-10-09T01:00:00Z", note: "" }] };
        return route.abort("failed"); // backend committed; response was lost
      }
      if (path === "approvals/" && method === "POST") {
        approval = { id: "approval-one", action: body.action, target_id: body.target_id, amount: body.amount, currency: body.currency, status: "PENDING", version: 1, expires_at: inOneHour() };
        return json(route, 201, { data: approval });
      }
      if (path === "auth/step-up/" && method === "POST") {
        stepUpCalls++;
        assert.equal(body.action, "remittance.submit");
        assert.equal(body.target_id, "order-one");
        return json(route, 200, { token: "ephemeral-grant", expires_in_seconds: 300 });
      }
      return json(route, 404, { detail: `Unexpected ${method} ${path}` });
    });
    await page.goto(`${base}/?wallet=1`);
    await page.getByText("USD 800.00", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Remit" }).click();
    await page.getByLabel("Send amount USD").fill("200.00");
    await page.getByRole("button", { name: "Get backend quotes" }).click();
    await page.getByText("2 backend-priced routes returned").waitFor();
    assert.equal(quoteCalls, 2);
    // Quotes are priced for one amount: editing it discards them, so no order can use the old price.
    await page.getByLabel("Send amount USD").fill("250.00");
    assert.equal(await page.getByRole("button", { name: "Recipient & purpose →" }).isDisabled(), true);
    await page.getByLabel("Send amount USD").fill("200.00");
    await page.getByRole("button", { name: "Get backend quotes" }).click();
    for (let attempt = 0; attempt < 50 && quoteCalls < 4; attempt++) await page.waitForTimeout(100);
    assert.equal(quoteCalls, 4);
    // Recipient and purpose open in a sheet over the quotes.
    await page.getByRole("button", { name: "Recipient & purpose →" }).click();
    const sheet = page.getByRole("dialog", { name: "Recipient & purpose" });
    await sheet.getByLabel("Recipient", { exact: true }).selectOption("BENEFICIARY");
    await page.getByLabel("Beneficiary", { exact: true }).selectOption("school-one");
    assert.notEqual(await page.getByLabel("Beneficiary", { exact: true }).locator("option[value='housing-one']").getAttribute("disabled"), null);
    await page.getByLabel("Needed by").fill("2026-10-20");
    await sheet.getByRole("button", { name: "Create order for review" }).click();
    await page.getByText("Simulated order prepared").waitFor();
    assert.equal(await sheet.count(), 0);
    assert.equal(createCalls, 1);
    await page.getByLabel("I reviewed this exact simulated transfer").check();
    await page.getByRole("button", { name: "Confirm submission" }).click();
    await page.getByText("A separate operator approval is required").waitFor();
    await page.getByRole("button", { name: "Request operator approval" }).click();
    await page.getByText("Approval requested").waitFor();
    assert.match(await page.locator(".wallet-approval-status").innerText(), /Operator approval: PENDING/);
    operatorApproved = true;
    await page.getByRole("button", { name: "Refresh order status" }).click();
    await page.locator(".wallet-approval-status").getByText("APPROVED", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Continue to password check" }).click();
    await page.getByLabel("Password").fill("never-logged");
    await page.getByRole("button", { name: "Authorize and submit" }).click();
    await page.getByText("The response was lost or the server failed.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Password").inputValue(), "");
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Refresh order status" }).click();
    await page.getByText("Submitted to the simulated processing route.", { exact: false }).waitFor();
    assert.equal(createCalls, 1);
    assert.equal(stepUpCalls, 1);
    assert.equal(submitCalls, 2);
    assert.equal(calls.some((item) => item.path.includes("adapter-event") || item.path.includes("verify/") || item.path.includes("decide/")), false);
    await page.reload();
    await page.getByRole("tab", { name: "Remit" }).click();
    await page.getByRole("button", { name: /^Current order/ }).click();
    await page.getByText("Submitted to the simulated processing route.", { exact: false }).waitFor();
    await page.screenshot({ path: screenshot('wallet-live-mock-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
  });
});
