import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";
import { enrolledPlanner } from "../plannerMock.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const STATEMENT = "eyJzbmFwc2hvdF9pZCI6IjEifQ:1tAbCd:SiGnAtUrE_value-0123456789";
const DISCLAIMER = "Simulated on-time record inside StudyFlow. Not a credit score and not reported to or obtained from any credit bureau.";

test.describe("credit statement previews", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("trust preview shows the statement section read-only without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?trust=preview`);
    await page.getByRole("button", { name: "Share my record" }).click();
    const section = page.getByRole("dialog", { name: "Share your on-time record" });
    await page.getByRole("heading", { name: "Share your on-time record" }).waitFor();
    await section.locator("#trust-statements li", { hasText: /Fair.*4 on time · 0 late · 0 overdue/ }).waitFor();
    assert.equal(await section.getByRole("button", { name: "Take a snapshot now" }).isDisabled(), true);
    assert.equal(await section.getByRole("button", { name: /Issue signed statement/ }).first().isDisabled(), true);
    assert.match(await section.getByRole("textbox", { name: "Signed statement" }).inputValue(), /EXAMPLE-not-a-real-signature/);
    await section.getByText(/Only a summary: your username, the level/).waitFor();
    await section.getByText(/expires 90 days after it is issued/).waitFor();
    assert.equal(await section.getByRole("link", { name: "Open the verification page" }).getAttribute("href"), "/?verify=preview");
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("credit-trust-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "分享你的按时记录" }).waitFor();
    await page.getByRole("heading", { name: "声明会透露什么" }).waitFor();
    assert.equal(await noOverflow(page), true);
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });

  test("verify preview shows a valid and an invalid example without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?verify=preview`);
    await page.getByRole("heading", { name: "Verify an on-time statement" }).waitFor();
    await page.getByRole("heading", { name: "Example: valid statement" }).waitFor();
    await page.getByText("preview-student").waitFor();
    await page.getByRole("heading", { name: "Example: expired statement" }).waitFor();
    await page.getByText(/more than 90 days old/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Verify statement" }).isDisabled(), true);
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("credit-verify-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "核验按时记录声明" }).waitFor();
    await page.getByRole("heading", { name: "示例：已过期的声明" }).waitFor();
    assert.equal(await noOverflow(page), true);
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("credit statements with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("takes a snapshot, issues a statement and copies it without storing it", async ({ page, context }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    const snap = { id: "00000000-0000-4000-8000-0000000c5101", created_at: "2026-10-12T02:00:00Z", level: "GOOD", on_time: 7, late: 0, overdue: 0, as_of: "2026-10-12",
      factors: [], evidence: [], limit_multiplier: "1.5", next_level: null, disclaimer: DISCLAIMER };
    const posts = [];
    let snapshots = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        posts.push({ path, body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
        if (path === "credit/snapshots/") { snapshots = [snap]; return json(route, 201, { data: snap }); }
        if (path === "credit/statements/") return json(route, 201, { data: { statement: STATEMENT, expires_in_days: 90, snapshot_id: snap.id, level: "GOOD", is_simulated: true } });
        return json(route, 404, { detail: "unexpected" });
      }
      if (path === "credit/snapshots/") return json(route, 200, { count: snapshots.length, next: null, previous: null, results: snapshots });
      if (path === "credit/profile/") return json(route, 200, { data: { level: "GOOD", on_time: 7, late: 0, overdue: 0, as_of: "2026-10-12", limit_multiplier: "1.5", factors: [], next_level: null, evidence: [], is_simulated: true, disclaimer: DISCLAIMER } });
      if (path === "policy/limits/") return json(route, 200, { data: { credit_level: "GOOD", limit_multiplier: "1.5", window_zone: "Asia/Bangkok", is_simulated: true, limits: [] } });
      if (path === "approvals/" || path === "audit/") return json(route, 200, { count: 0, next: null, previous: null, results: [] });
      return json(route, 404, { detail: "unexpected" });
    });
    await enrolledPlanner(page);
    await page.goto(`${base}/?trust=1`);
    await page.getByRole("button", { name: "Share my record" }).click();
    const section = page.getByRole("dialog", { name: "Share your on-time record" });
    await section.getByText("No snapshots yet. Take one to issue a statement.").waitFor();
    await section.getByRole("button", { name: "Take a snapshot now" }).click();
    await section.getByText("Snapshot taken (level Good).").waitFor();
    await section.locator("#trust-statements li", { hasText: /Good.*7 on time · 0 late · 0 overdue/ }).waitFor();
    await section.getByRole("button", { name: /Issue signed statement for the snapshot/ }).click();
    await section.getByText("Signed statement issued. It expires in 90 days.").waitFor();
    assert.equal(await section.getByRole("textbox", { name: "Signed statement" }).inputValue(), STATEMENT);
    assert.equal(await section.getByRole("link", { name: "Open the verification page" }).getAttribute("href"), "/?verify=1");
    await section.getByRole("button", { name: "Copy statement" }).click();
    await section.getByText("Statement copied.").waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), STATEMENT);
    assert.deepEqual(posts.map(({ path, body }) => ({ path, body })), [
      { path: "credit/snapshots/", body: {} },
      { path: "credit/statements/", body: { snapshot_id: snap.id } },
    ]);
    assert.ok(posts.every(item => item.key));
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    assert.equal(stored.includes(STATEMENT), false);
    await page.screenshot({ path: screenshot("credit-trust-issued-desktop.png"), fullPage: true });
    assert.deepEqual(errors, []);
  });

  test("hides the statement section when signed out (the enrollment gate keeps the credit tool closed)", async ({ page }) => {
    // Signed out, the planner cannot load, so the student counts as not enrolled and the credit tool
    // (with its statement section) never opens; no statement endpoint is called.
    const reads = [];
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    await page.route("**/api/v2/**", route => { reads.push(new URL(route.request().url()).pathname); return json(route, 403, { detail: "Authentication credentials were not provided." }); });
    await page.goto(`${base}/?trust=1`);
    await page.getByRole("status").filter({ hasText: "That tool opens once enrollment is confirmed." }).waitFor();
    await page.getByRole("link", { name: "Sign in to StudyFlow" }).waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator("#trust-tiers").count(), 0);
    assert.equal(await page.locator("#trust-statements").count(), 0);
    assert.equal(reads.some(path => path.includes("credit") || path.includes("statement")), false);
  });
});

test.describe("public statement verification with mocked Django", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("verifies anonymously with plain fetch: valid and invalid results, zh reasons", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    const calls = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      const headers = request.headers();
      calls.push({ path, method: request.method(), body: request.postDataJSON(), headers });
      if (path !== "credit/statements/verify/") return json(route, 404, { detail: "unexpected" });
      const { statement } = request.postDataJSON();
      if (statement === STATEMENT) return json(route, 200, { data: { valid: true, snapshot_id: "s1", holder: "student-anna", level: "FAIR", on_time: 4, late: 1, overdue: 0,
        as_of: "2026-10-11", issued_at: "2026-10-11T03:25:00+00:00", is_simulated: true, disclaimer: DISCLAIMER } });
      return json(route, 200, { data: { valid: false, reason: statement.endsWith("old") ? "EXPIRED" : "INVALID_SIGNATURE" } });
    });
    await page.goto(`${base}/?verify=1`);
    await page.getByRole("heading", { name: "Verify an on-time statement" }).waitFor();
    const field = page.locator("#verify-statement");
    // Wrapped by an email client: whitespace is removed before sending.
    await field.fill(`  ${STATEMENT.slice(0, 20)}\n${STATEMENT.slice(20)}\n`);
    await page.getByRole("button", { name: "Verify statement" }).click();
    await page.getByRole("heading", { name: "Valid statement" }).waitFor();
    await page.getByText("student-anna").waitFor();
    await page.locator(".credit-result.valid dd", { hasText: "Fair" }).waitFor();
    await page.locator(".credit-result.valid").getByText(/Not a credit score/).waitFor();
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("credit-verify-valid-mobile.png"), fullPage: true });

    await field.fill(STATEMENT.replace("SiGn", "XiGn"));
    await page.getByRole("button", { name: "Verify statement" }).click();
    await page.getByRole("heading", { name: "Not a valid statement" }).waitFor();
    await page.getByText(/The signature does not match/).waitFor();

    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "核验按时记录声明" }).waitFor();
    await page.getByText(/签名不匹配/).waitFor();
    await field.fill(`${STATEMENT}old`);
    await page.getByRole("button", { name: "核验声明" }).click();
    await page.getByText("声明已超过 90 天。请让学生重新签发。").waitFor();
    assert.equal(await noOverflow(page), true);
    await page.screenshot({ path: screenshot("credit-verify-invalid-mobile-zh.png"), fullPage: true });

    assert.deepEqual(calls.map(item => [item.method, item.path, item.body.statement]), [
      ["POST", "credit/statements/verify/", STATEMENT],
      ["POST", "credit/statements/verify/", STATEMENT.replace("SiGn", "XiGn")],
      ["POST", "credit/statements/verify/", `${STATEMENT}old`],
    ]);
    for (const { headers } of calls) {
      assert.equal(headers["x-csrftoken"], undefined);
      assert.equal(headers["idempotency-key"], undefined);
      assert.equal(headers.cookie, undefined);
    }
    assert.equal(calls[0].headers["accept-language"], "en");
    assert.equal(calls[2].headers["accept-language"], "zh-Hans");
    assert.deepEqual(errors, []);
  });

  test("rejects an over-long statement locally", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/v2/**", route => { calls++; return route.abort(); });
    await page.goto(`${base}/?verify=1`);
    await page.locator("#verify-statement").fill("x".repeat(4001));
    await page.getByRole("button", { name: "Verify statement" }).click();
    await page.getByText("That text is longer than 4000 characters, so it is not a StudyFlow statement.").waitFor();
    assert.equal(calls, 0);
  });
});
