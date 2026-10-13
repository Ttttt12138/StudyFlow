import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const TOKEN = "0123456789abcdef".repeat(4);
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe("family previews", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("family requests preview is read-only at phone width without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?family=preview`);
    const list = page.locator("#family-requests");
    await page.getByRole("heading", { name: "Your requests" }).waitFor();
    const supported = page.locator("#family-supported");
    await list.getByText("Pending", { exact: true }).first().waitFor();
    await list.getByText(/Waiting for an operator to send the confirmation link/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Revise" }).first().isDisabled(), true);
    await list.getByRole("button", { name: "Next" }).click();
    await list.getByText(/Link sent — waiting for your family member/).waitFor();
    await page.getByRole("tab", { name: "Supported" }).click();
    await supported.getByText("Confirmed", { exact: true }).first().waitFor();
    await supported.getByText(/Confirmed — waiting for the money to be received/).waitFor();
    await supported.getByRole("button", { name: "Next" }).click();
    await supported.getByText("Received", { exact: true }).first().waitFor();
    await supported.getByText(/an operator recorded the money/).waitFor();
    await page.getByRole("tab", { name: "Ask family" }).click();
    assert.equal(await page.getByRole("button", { name: "Create request" }).isDisabled(), true);
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("family-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "家庭资助如何运作" }).waitFor();
    await page.getByRole("tab", { name: "已获支持" }).click();
    await supported.getByText("已到账", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "申请" }).click();
    await page.getByRole("heading", { name: "你的请求" }).waitFor();
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("family-preview-mobile-zh.png"), fullPage: true });
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });

  test("sponsor preview shows the sample request without calling Django", async ({ page }) => {
    let apiCalls = 0;
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?sponsor=preview`);
    await page.getByRole("heading", { name: "What your answer means" }).waitFor();
    await page.getByText("Second tuition installment").waitFor();
    assert.equal(await page.getByRole("button", { name: "Confirm support" }).isDisabled(), true);
    assert.equal(await noOverflow(page), true);
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "你的回复意味着什么" }).waitFor();
    await page.screenshot({ path: screenshot("sponsor-preview-mobile-zh.png"), fullPage: true });
    assert.equal(apiCalls, 0);
  });
});

test.describe("family requests with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("creates, revises and withdraws a request with exact bodies", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    const source = (n, currency, amount, available_on, extra = {}) => ({ id: `f${n}`, economic_key: `family-x-${n}`, kind: "family", currency, amount, available_on, certainty: "estimated", received: false, ...extra });
    const requests = [
      { id: "00000000-0000-4000-8000-0000000000a1", created_at: "2026-10-10T00:00:00Z", source: source(1, "CNY", "8000.00", "2026-11-01"), purpose: "Rent deposit",
        terms_version: 1, status: "PENDING", token_expires_at: "2026-10-14T00:00:00Z", confirmed_at: null },
      { id: "00000000-0000-4000-8000-0000000000a2", created_at: "2026-09-01T00:00:00Z", source: source(2, "THB", "5000.00", "2026-09-10", { certainty: "confirmed", received: true }), purpose: "Books",
        terms_version: 1, status: "RECEIVED", token_expires_at: null, confirmed_at: "2026-09-02T00:00:00Z" },
    ];
    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        posts.push({ path, body });
        assert.ok(request.headers()["idempotency-key"]);
        assert.equal(request.headers()["x-csrftoken"], "t");
        if (path === "sponsor-requests/") {
          assert.match(body.economic_key, /^family-laptop-for-coursework-[0-9a-f]{8}$/);
          assert.deepEqual({ ...body, economic_key: "k" }, { economic_key: "k", amount: "120000", currency: "JPY", available_on: "2026-12-01", purpose: "Laptop for coursework" });
          const created = { id: "00000000-0000-4000-8000-0000000000a3", created_at: "2026-10-12T00:00:00Z", source: { ...source(3, "JPY", "120000.00", "2026-12-01"), economic_key: body.economic_key },
            purpose: body.purpose, terms_version: 1, status: "PENDING", token_expires_at: null, confirmed_at: null };
          requests.unshift(created);
          return json(route, 201, { data: created });
        }
        const target = requests.find(r => path === `sponsor-requests/${r.id}/revise/`);
        if (target) {
          if (body.terms_version !== target.terms_version) return json(route, 409, { detail: "conflict" });
          target.terms_version += 1; target.token_expires_at = null;
          if (body.action === "revise") Object.assign(target, { purpose: body.purpose, status: "PENDING", source: { ...target.source, amount: body.amount, currency: body.currency, available_on: body.available_on } });
          else target.status = "REVOKED";
          return json(route, 201, { data: target });
        }
        return json(route, 500, { detail: `unexpected POST ${path}` });
      }
      if (path === "sponsor-requests/") return json(route, 200, { data: requests });
      return json(route, 404, { detail: path });
    });
    await page.goto(`${base}/?family=1`);
    const list = page.locator("#family-requests");
    await list.getByText(/Link sent — waiting for your family member/).waitFor();
    await page.getByRole("tab", { name: "Supported" }).click();
    await page.locator("#family-supported").getByText(/Received support is final/).waitFor();

    await page.getByRole("tab", { name: "Ask family" }).click();
    const create = page.locator("#family-create");
    await create.getByLabel("Amount").fill("100.50");
    await create.getByLabel("Currency").selectOption("JPY");
    await create.getByLabel("Available on").fill("2026-12-01");
    await create.getByLabel("Purpose").fill("Laptop for coursework");
    await page.getByRole("button", { name: "Create request" }).click();
    await page.getByRole("alert").getByText("JPY amounts must be whole yen (no decimals).").waitFor();
    assert.equal(posts.length, 0);
    await create.getByLabel("Amount").fill("120000");
    await page.getByRole("button", { name: "Create request" }).click();
    await page.getByRole("status").getByText(/Request created \(reference family-laptop-for-coursework-/).waitFor();
    await list.getByRole("heading", { name: "Laptop for coursework" }).waitFor();

    await list.getByRole("button", { name: "Next" }).click();
    const rent = list.locator("article", { has: page.getByRole("heading", { name: "Rent deposit" }) });
    await rent.waitFor();
    await page.getByRole("button", { name: "Revise", exact: true }).click();
    const form = page.getByRole("form", { name: "Revise request" });
    await form.getByText(/Revising invalidates any link already sent/).waitFor();
    await form.getByLabel("Amount").fill("9000.00");
    await form.getByLabel("Available on").fill("2026-11-15");
    const save = page.getByRole("button", { name: "Save revised request" });
    assert.equal(await save.isDisabled(), true);
    await form.getByLabel(/the current link stops working/).check();
    await save.click();
    await page.getByText("Request revised. Any link already sent no longer works; a new confirmation is needed.").waitFor();
    assert.deepEqual(posts.at(-1), { path: `sponsor-requests/${requests[1].id}/revise/`,
      body: { terms_version: 1, action: "revise", amount: "9000.00", currency: "CNY", available_on: "2026-11-15", purpose: "Rent deposit" } });
    await rent.getByText(/Waiting for an operator to send the confirmation link/).waitFor();

    await page.getByRole("button", { name: "Withdraw" }).click();
    await rent.getByText(/Withdraw this request\?/).waitFor();
    await page.getByRole("button", { name: "Yes, withdraw" }).click();
    await page.getByText("Request withdrawn. Any link already sent no longer works.").waitFor();
    assert.deepEqual(posts.at(-1), { path: `sponsor-requests/${requests[1].id}/revise/`, body: { terms_version: 2, action: "revoke" } });
    await rent.getByText("Withdrawn", { exact: true }).waitFor();
    assert.equal(posts.length, 3);
    assert.deepEqual(errors, []);
  });

  test("shows the signed-out card when the session is anonymous", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    await page.goto(`${base}/?family=1`);
    await page.getByText("Sign in to StudyFlow to ask your family for support.").waitFor();
  });
});

test.describe("sponsor confirmation with mocked Django", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const preview = { request_id: "r1", terms_version: 3, amount: "45000.00", currency: "THB", available_on: "2026-10-25", purpose: "Second tuition installment",
    expires_at: "2026-10-14T02:00:00Z", is_simulated: true };

  test("reads the token from the fragment, removes it and confirms with a reused idempotency key", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    const posts = [];
    let reads = 0;
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const headers = request.headers();
      assert.equal(new URL(request.url()).pathname, "/api/v2/sponsor-confirmation/");
      assert.equal(headers["x-sponsor-token"], TOKEN);
      assert.equal(headers["x-csrftoken"], undefined);
      assert.ok(!request.url().includes(TOKEN));
      if (request.method() === "GET") { reads++; return json(route, 200, { data: preview }); }
      posts.push({ body: request.postDataJSON(), key: headers["idempotency-key"], lang: headers["accept-language"] });
      // The first answer is lost on the way back; the retry must reuse the key.
      if (posts.length === 1) return route.abort();
      return json(route, 200, { data: { request_id: "r1", status: "CONFIRMED", is_simulated: true } });
    });
    await page.goto(`${base}/?sponsor=1#token=${TOKEN}`);
    await page.getByText("Second tuition installment").waitFor();
    assert.equal(await page.evaluate(() => location.href.includes("token")), false);
    assert.equal(new URL(page.url()).search, "?sponsor=1");
    assert.ok(reads >= 1);
    assert.equal(await page.evaluate(token => JSON.stringify(localStorage).includes(token) || JSON.stringify(sessionStorage).includes(token), TOKEN), false);
    await page.getByText(/no money moves now/).first().waitFor();

    await page.getByRole("button", { name: "Confirm support" }).click();
    const step = page.getByRole("group", { name: "Check your answer" });
    await step.getByText(/You are about to confirm/).waitFor();
    const send = step.getByRole("button", { name: "Send confirmation" });
    assert.equal(await send.isDisabled(), true);
    await step.getByLabel(/I confirm I plan to provide this support/).check();
    await send.click();
    await page.getByRole("alert").getByText(/The answer may not have arrived/).waitFor();
    await send.click();
    await page.getByText(/your confirmation was recorded/).waitFor();
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, { terms_version: 3, decision: "confirm" });
    assert.deepEqual(posts[1].body, posts[0].body);
    assert.ok(posts[0].key);
    assert.equal(posts[1].key, posts[0].key);
    assert.equal(posts[0].lang, "en");
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("sponsor-confirmed-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
  });

  test("translates token errors, rejects bad pastes and handles throttling", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    const other = "f".repeat(64);
    await page.route("**/api/v2/sponsor-confirmation/", route => {
      const token = route.request().headers()["x-sponsor-token"];
      if (token === TOKEN) return json(route, 400, { detail: "SPONSOR_TOKEN_EXPIRED", code: "SPONSOR_TOKEN_EXPIRED", message: "expired" });
      if (token === other) return json(route, 429, { detail: "Request was throttled.", code: "throttled", message: "Request was throttled." });
      return json(route, 403, { detail: "INVALID_SPONSOR_TOKEN", code: "INVALID_SPONSOR_TOKEN", message: "invalid" });
    });
    await page.goto(`${base}/?sponsor=1#token=${TOKEN}`);
    await page.getByRole("alert").getByText("This link has expired. Ask the student to have a new one sent.").waitFor();
    const field = page.getByLabel("Link or code");
    await field.fill("https://example.test/?sponsor=1#token=abc");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("alert").getByText(/does not look like a confirmation link/).waitFor();
    await field.fill(`http://127.0.0.1:5180/?sponsor=1#token=${other}`);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("alert").getByText(/Too many attempts/).waitFor();
    await field.fill("1".repeat(64));
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("alert").getByText(/This link is not valid/).waitFor();
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "请求内容" }).waitFor();
  });

  test("shows the declined result and the used-link message", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    let answered = false;
    await page.route("**/api/v2/sponsor-confirmation/", route => {
      const request = route.request();
      if (request.method() === "POST") {
        assert.deepEqual(request.postDataJSON(), { terms_version: 3, decision: "reject" });
        assert.ok(request.headers()["idempotency-key"]);
        answered = true;
        return json(route, 200, { data: { request_id: "r1", status: "REJECTED", is_simulated: true } });
      }
      return answered ? json(route, 400, { detail: "SPONSOR_TOKEN_USED", code: "SPONSOR_TOKEN_USED", message: "used" }) : json(route, 200, { data: preview });
    });
    await page.goto(`${base}/?sponsor=1#token=${TOKEN}`);
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByLabel("I do not plan to provide this support.").check();
    await page.getByRole("button", { name: "Send decline" }).click();
    await page.getByText(/you declined this request/).waitFor();
    // Opening the same link again shows that it was already answered.
    await page.getByLabel("Link or code").fill(TOKEN.toUpperCase());
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("alert").getByText("This request has already been answered with this link.").waitFor();
  });
});
