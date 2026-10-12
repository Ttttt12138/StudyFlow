import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

test.describe("wallet conversion and ledger preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows fixed conversion quotes and ledger read-only at phone width without any API call", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?wallet=preview`);
    await page.getByRole("tab", { name: "Exchange" }).click();
    const convert = page.locator("#wallet-convert");
    await convert.getByRole("heading", { name: "Convert between currencies" }).waitFor();
    await convert.getByText("Example route (standard)").waitFor();
    await convert.getByText(/\d:\d\d left/).first().waitFor();
    await convert.getByRole("heading", { name: "Review the conversion" }).waitFor();
    assert.equal(await convert.getByRole("button", { name: "Get conversion quotes" }).isDisabled(), true);
    assert.equal(await convert.getByRole("button", { name: "Convert now" }).isDisabled(), true);
    assert.equal(await convert.getByLabel("I reviewed these exact amounts").isDisabled(), true);
    await convert.getByText("USD 150.00 → THB 4,893.00").waitFor();
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByRole("button", { name: "Ledger", exact: true }).click();
    const ledger = page.locator("#wallet-ledger");
    await ledger.getByRole("heading", { name: "Ledger" }).waitFor();
    await ledger.getByRole("row", { name: /Tuition \/ bill payment.*− THB 12,000\.00/ }).waitFor();
    await ledger.getByRole("row", { name: /Funding received.*\+ USD 1,100\.00/ }).waitFor();
    assert.equal(await ledger.getByRole("row", { name: /Currency conversion/ }).count(), 2);
    await ledger.getByLabel("Currency").selectOption("USD");
    assert.equal(await ledger.locator("tbody tr").count(), 3);
    await ledger.getByText("append-only").waitFor();
    // WalletApp's own preview still renders around this section.
    await page.getByRole("tab", { name: "Balances" }).click();
    await page.getByText("THB 52,500.00").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("wallet-extras-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("tab", { name: "换汇" }).click();
    await convert.getByRole("heading", { name: "币种兑换" }).waitFor();
    await page.getByRole("tab", { name: "记录" }).click();
    await ledger.getByRole("row", { name: /资金到账.*\+ USD 1,100\.00/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

function mockDjango(page, { conversionReply }) {
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const posts = [];
  let balanceReads = 0, converted = false, quoteCount = 0;
  const entry = (id, sequence, currency, amount, origin) => ({ id, created_at: "2026-10-10T00:00:00Z", installment: null, sequence, funding_source: null, disbursement: null,
    payment: null, conversion: null, remittance_order: null, remittance_leg: null, currency, amount, effective_on: "2026-10-10", ...origin });
  const conversion = { id: "conv-1", type: "currencyconversion", created_at: "2026-10-12T02:00:00Z", quote: "q-standard", quote_id: "q-standard", source_currency: "USD",
    source_amount: "200.00", target_currency: "THB", target_amount: "6560.43", rate: "33.0500000000", sender_fee: "1.50", receiver_fee: "0.00", effective_on: "2026-10-12",
    is_simulated: true, debit_sequence: 4, credit_sequence: 5 };
  const corridors = [
    { id: "usd-express", code: "usd-thb-express", provider: "Mock", tier: "express", source_currency: "USD", target_currency: "THB", enabled: true, min_amount: "10.00", max_amount: "1500.00", settlement_min_days: 0, settlement_days: 0, is_simulated: true },
    { id: "usd-standard", code: "usd-thb-standard", provider: "Mock", tier: "standard", source_currency: "USD", target_currency: "THB", enabled: true, min_amount: "10.00", max_amount: "3000.00", settlement_min_days: 0, settlement_days: 0, is_simulated: true },
    { id: "thb-standard", code: "thb-cny-standard", provider: "Mock", tier: "standard", source_currency: "THB", target_currency: "CNY", enabled: true, min_amount: "500.00", max_amount: "50000.00", settlement_min_days: 0, settlement_days: 0, is_simulated: true },
    { id: "cny-standard", code: "cny-thb-standard", provider: "Mock", tier: "standard", source_currency: "CNY", target_currency: "THB", enabled: true, min_amount: "100.00", max_amount: "20000.00", settlement_min_days: 0, settlement_days: 0, is_simulated: true },
  ];
  const route = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v2/", "");
    const method = request.method();
    if (method === "POST") {
      const body = request.postDataJSON();
      posts.push({ path, body, headers: request.headers() });
      assert.equal(request.headers()["x-csrftoken"], "t");
      assert.ok(request.headers()["idempotency-key"]);
      if (path === "fx-quotes/live/") {
        quoteCount++;
        const tier = body.corridor_id.split("-")[1];
        const source = body.corridor_id.startsWith("thb") ? "THB" : "USD";
        return json(route, 201, { data: { id: `q-${tier}${quoteCount > 2 ? quoteCount : ""}`, corridor_id: body.corridor_id, corridor: body.corridor_id, route_name: `Mock (${tier})`, source_currency: source,
          target_currency: source === "THB" ? "CNY" : "THB", rate: tier === "express" ? "32.8000000000" : "33.0500000000", sender_fee: "1.50", receiver_fee: "0.00",
          settlement_min_days: 0, settlement_days: 0, expires_at: inMinutes(10), is_mock: true, rate_source: "fixture", rate_date: "2026-10-12", mid_rate: "33.1",
          consumed_at: null, quoted_amount: body.send_amount, send_amount: body.send_amount, net_received: tier === "express" ? "6461.60" : "6560.43", is_reference_rate: true } });
      }
      if (path === "auth/step-up/") return json(route, 200, { token: "grant-1", expires_in_seconds: 300 });
      if (path === "conversions/") {
        const reply = conversionReply(request.headers(), posts.filter((item) => item.path === "conversions/").length);
        if (reply.status === 201) converted = true;
        return json(route, reply.status, reply.status === 201 ? { data: conversion } : reply.body);
      }
      return json(route, 404, { detail: `Unexpected POST ${path}` });
    }
    if (path === "demo/wallets/balances/") { balanceReads++; return json(route, 200, { data: { home_currency: "THB", is_simulated: true, balances: [
      { currency: "THB", balance: "40000.00", available_balance: "40000.00", is_home: true, indicative_home_value: "40000.00", valuation: null },
      { currency: "USD", balance: "800.00", available_balance: "800.00", is_home: false, indicative_home_value: "26400.00", valuation: null },
      { currency: "CNY", balance: "0.00", available_balance: "0.00", is_home: false, indicative_home_value: "0.00", valuation: null }] } }); }
    if (path === "corridors/") return json(route, 200, { data: corridors });
    if (path === "state/") return json(route, 200, { id: "state-1", version: 7, snapshot: { reserve: "30000.00" } });
    if (path === "ledger/") {
      if (url.searchParams.get("page") === "2") return json(route, 200, { count: 3, next: null, previous: `${base}/api/v2/ledger/`, results: [entry("l1", 1, "THB", "20000.00", { disbursement: "d1" })] });
      const fresh = converted ? [entry("l5", 5, "THB", "6560.43", { conversion: "conv-1" }), entry("l4", 4, "USD", "-200.00", { conversion: "conv-1" })] : [];
      return json(route, 200, { count: 3 + fresh.length, next: `${base}/api/v2/ledger/?page=2`, previous: null,
        results: [...fresh, entry("l3", 3, "USD", "-100.00", { remittance_order: "o1", remittance_leg: "debit" }), entry("l2", 2, "USD", "1000.00", { funding_source: "f1" })] });
    }
    if (path === "conversions/") return json(route, 200, { count: converted ? 1 : 0, next: null, previous: null, results: converted ? [conversion] : [] });
    if (["beneficiaries/", "remittance-orders/", "approvals/"].includes(path)) return json(route, 200, { count: 0, next: null, previous: null, results: [] });
    return json(route, 404, { detail: `Unexpected GET ${path}` });
  };
  return { route, posts, balanceReads: () => balanceReads };
}

test.describe("wallet conversion with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{ name: "csrftoken", value: "t", url: base }]);
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
  });

  test("quotes every tier, converts after a password step-up, and pages the ledger", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const mock = mockDjango(page, { conversionReply: (headers) => headers["x-step-up-token"]
      ? { status: 201 } : { status: 403, body: { detail: "STEP_UP_REQUIRED", code: "STEP_UP_REQUIRED", message: "Confirm with your password.", policy: { tier: "T2", requires: ["step_up"] } } } });
    await page.route("**/api/v2/**", mock.route);
    await page.goto(`${base}/?wallet=1`);
    const convert = page.locator("#wallet-convert");
    const ledger = page.locator("#wallet-ledger");
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByRole("button", { name: "Ledger", exact: true }).click();
    await ledger.getByRole("row", { name: /Funding received.*\+ USD 1,000\.00/ }).waitFor();
    await ledger.getByRole("row", { name: /Transfer sent.*− USD 100\.00/ }).waitFor();
    await ledger.getByText("2 of 3 entries").waitFor();
    await ledger.getByRole("button", { name: "Load more entries" }).click();
    await ledger.getByRole("row", { name: /Loan disbursement.*\+ THB 20,000\.00/ }).waitFor();
    assert.equal(await ledger.getByRole("button", { name: "Load more entries" }).count(), 0);
    await ledger.getByLabel("Currency").selectOption("THB");
    assert.equal(await ledger.locator("tbody tr").count(), 1);
    await ledger.getByLabel("Currency").selectOption("all");

    // Only held balances with a seeded direction are offered; CNY has no balance.
    await page.getByRole("tab", { name: "Exchange" }).click();
    const from = convert.getByLabel("Convert from");
    assert.deepEqual(await from.locator("option").allTextContents(), ["USD", "THB (home)"]);
    assert.deepEqual(await convert.getByLabel("Convert to").locator("option").allTextContents(), ["THB"]);
    await convert.getByText("Accepted amounts: USD 10.00 to USD 3,000.00 across 2 tiers").waitFor();
    await convert.getByLabel("Amount to convert (USD)").fill("5");
    await convert.getByRole("button", { name: "Get conversion quotes" }).click();
    await convert.getByRole("alert").getByText("below the smallest accepted amount (USD 10.00)").waitFor();
    assert.equal(mock.posts.length, 0);
    await convert.getByLabel("Amount to convert (USD)").fill("200.00");
    await convert.getByRole("button", { name: "Get conversion quotes" }).click();
    await convert.getByText("2 quote(s) returned").waitFor();
    assert.deepEqual(mock.posts.map((item) => item.body).sort((a, b) => a.corridor_id.localeCompare(b.corridor_id)),
      [{ corridor_id: "usd-express", send_amount: "200.00" }, { corridor_id: "usd-standard", send_amount: "200.00" }]);
    await convert.getByText(/(9|10):\d\d left/).first().waitFor();
    const standard = convert.locator("article", { hasText: "Mock (standard)" });
    await standard.getByRole("button", { name: "Use this quote" }).click();
    const review = convert.locator(".wallet-review", { hasText: "Review the conversion" });
    await review.getByText("THB 6,560.43").waitFor();
    assert.equal(await review.getByText("home currency").count(), 0);
    assert.equal(await review.getByRole("button", { name: "Convert now" }).isDisabled(), true);
    await review.getByLabel("I reviewed these exact amounts and want to convert").check();
    await review.getByRole("button", { name: "Convert now" }).click();
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("heading", { name: "Confirm with your password" }).waitFor();
    await page.getByLabel("Password").fill("student-pass");
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Confirm", exact: true }).click();
    await convert.getByRole("heading", { name: "Conversion recorded" }).waitFor();
    await convert.getByText("#4 / #5").waitFor();
    await convert.getByText("USD 200.00 → THB 6,560.43").waitFor();
    await page.getByRole("tab", { name: "History" }).click();
    await ledger.getByRole("row", { name: /Currency conversion.*− USD 200\.00/ }).waitFor();

    const steps = mock.posts.filter((item) => item.path !== "fx-quotes/live/");
    assert.deepEqual(steps.map((item) => item.path), ["conversions/", "auth/step-up/", "conversions/"]);
    assert.deepEqual(steps[0].body, { quote_id: "q-standard", source_amount: "200.00", state_version: 7 });
    assert.equal(steps[0].headers["x-step-up-token"], undefined);
    assert.deepEqual(steps[1].body, { password: "student-pass", action: "wallet.convert", target_id: "q-standard", amount: "200.00", currency: "USD" });
    assert.deepEqual(steps[2].body, { quote_id: "q-standard", source_amount: "200.00", state_version: 7 });
    assert.equal(steps[2].headers["x-step-up-token"], "grant-1");
    // Same body, same identity: the retried command reuses the idempotency key.
    assert.equal(steps[2].headers["idempotency-key"], steps[0].headers["idempotency-key"]);
    // onChanged refreshed WalletApp's balances (StrictMode reads twice on mount).
    for (let attempt = 0; attempt < 30 && mock.balanceReads() < 3; attempt++) await page.waitForTimeout(100);
    assert.ok(mock.balanceReads() >= 3);
    await page.screenshot({ path: screenshot("wallet-extras-mocked-desktop.png"), fullPage: true });
    assert.deepEqual(errors, []);
  });

  test("explains a state change and a reserve refusal on a home-currency conversion", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const mock = mockDjango(page, { conversionReply: (_headers, attempt) => attempt === 1
      ? { status: 409, body: { detail: "State version changed. Refresh and retry.", code: "stale_version", message: "State version changed. Refresh and retry." } }
      : { status: 400, body: { detail: "RESERVE_REQUIRED", code: "RESERVE_REQUIRED", message: "The home-currency reserve must stay in the wallet." } } });
    await page.route("**/api/v2/**", mock.route);
    await page.goto(`${base}/?wallet=1`);
    await page.getByRole("tab", { name: "Exchange" }).click();
    const convert = page.locator("#wallet-convert");
    await convert.getByLabel("Convert from").selectOption("THB");
    assert.deepEqual(await convert.getByLabel("Convert to").locator("option").allTextContents(), ["CNY"]);
    await convert.getByLabel("Amount to convert (THB)").fill("5000.00");
    await convert.getByRole("button", { name: "Get conversion quotes" }).click();
    await convert.getByText("1 quote(s) returned").waitFor();
    const review = convert.locator(".wallet-review", { hasText: "Review the conversion" });
    await review.getByText("This converts from your home currency (THB)").waitFor();
    await review.getByLabel("I reviewed these exact amounts and want to convert").check();
    await review.getByRole("button", { name: "Convert now" }).click();
    await convert.getByText("Your balances changed since this quote was reviewed.").waitFor();
    assert.equal(await review.getByLabel("I reviewed these exact amounts and want to convert").isChecked(), false);
    await review.getByLabel("I reviewed these exact amounts and want to convert").check();
    await review.getByRole("button", { name: "Convert now" }).click();
    await convert.getByRole("alert").getByText("The home-currency reserve must stay in the wallet. Converting from the home currency must leave the reserve untouched").waitFor();
    const attempts = mock.posts.filter((item) => item.path === "conversions/");
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1].body, { quote_id: "q-standard", source_amount: "5000.00", state_version: 7 });
    assert.notEqual(attempts[1].headers["idempotency-key"], undefined);
    assert.deepEqual(errors, []);
  });
});
