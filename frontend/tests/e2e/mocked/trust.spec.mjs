import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test.describe("permissions and activity preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows tiers, credit multiplier, limits, approvals and audit log read-only at phone width", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?trust=preview`);
    await page.getByRole("heading", { name: "Permissions & activity" }).waitFor();
    for (const tier of ["T0", "T1", "T2", "T3"]) await page.locator(`.tier-legend .tier-${tier.toLowerCase()}`).waitFor();
    await page.getByText("×1.2").waitFor();
    await page.getByText("Your T2 limits are the base limits × 1.2, set by this level.").waitFor();
    await page.getByRole("row", { name: /CNY 12,000\.00/ }).waitFor();
    await page.getByRole("row", { name: /Submit transfer.*CNY 15,000\.00.*Waiting for an operator/ }).waitFor();
    await page.getByRole("cell", { name: /Password re-check passed/ }).waitFor();
    await page.getByLabel("Show").selectOption("approval");
    assert.equal(await page.locator("#trust-audit tbody tr").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel("Show").selectOption("all");
    await page.screenshot({ path: screenshot("trust-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "权限与审计" }).waitFor();
    await page.getByRole("cell", { name: /密码二次验证通过/ }).waitFor();
    await page.screenshot({ path: screenshot("trust-preview-mobile-zh.png"), fullPage: true });
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("permissions and activity with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("reads profile, limits, approvals and pages through the audit log; sections fail independently", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "test-csrf" } }));
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const event = (n, action, details = {}) => ({ id: `e${n}`, action, entity_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      details: { actor_id: 7, ...details }, created_at: `2026-10-${String(11 - (n % 9)).padStart(2, "0")}T03:00:00Z` });
    const reads = [];
    await page.route("**/api/v2/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v2/", "");
      reads.push(path + url.search);
      assert.equal(route.request().method(), "GET");
      if (path === "credit/profile/") return json(route, 500, { detail: "Injected profile failure" });
      if (path === "policy/limits/") return json(route, 200, { data: { credit_level: "GOOD", limit_multiplier: "1.5", window_zone: "Asia/Bangkok", is_simulated: true,
        limits: [{ currency: "THB", base: { per_transaction: "50000.00", daily: "100000.00", monthly: "300000.00" },
          effective: { per_transaction: "75000.00", daily: "150000.00", monthly: "450000.00" }, usage: { daily: "9000.00", monthly: "9000.00" } }] } });
      if (path === "approvals/") return json(route, 200, { count: 0, next: null, previous: null, results: [] });
      if (path === "audit/" && !url.searchParams.get("page")) return json(route, 200, { count: 3, previous: null, next: `${base}/api/v2/audit/?page=2`,
        results: [event(1, "auth.step_up_granted", { action: "payment.submit", amount: "9000.00", currency: "THB" }), event(2, "payment.created")] });
      if (path === "audit/" && url.searchParams.get("page") === "2") return json(route, 200, { count: 3, previous: null, next: null,
        results: [event(3, "approval.approved", { action: "payment.submit", target_id: "x" })] });
      return json(route, 404, { detail: "unexpected" });
    });
    await page.goto(`${base}/?trust=1`);
    await page.getByRole("heading", { name: "Permissions & activity" }).waitFor();
    await page.locator("#trust-credit").getByText("Injected profile failure", { exact: false }).waitFor();
    await page.getByRole("row", { name: /THB 75,000\.00.*base THB 50,000\.00/ }).waitFor();
    await page.getByText("Effective limit = base limit × 1.5.", { exact: false }).waitFor();
    await page.getByText("No approval requests.").waitFor();
    await page.getByText("Showing 2 of 3").waitFor();
    await page.getByRole("cell", { name: /Submit payment · THB 9,000\.00 · by user #7/ }).waitFor();
    await page.getByRole("button", { name: "Load older events" }).click();
    await page.getByRole("cell", { name: /Approval granted by an operator/ }).waitFor();
    await page.getByText("Showing 3 of 3").waitFor();
    assert.equal(await page.getByRole("button", { name: "Load older events" }).count(), 0);
    assert.ok(reads.includes("audit/?page=2"));
    await page.screenshot({ path: screenshot("trust-connected-desktop.png"), fullPage: true });
    assert.deepEqual(errors, []);
  });

  test("signed-out students are sent to the StudyFlow sign-in page", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    await page.route("**/api/v2/**", route => route.abort());
    await page.goto(`${base}/?trust=1`);
    const link = page.getByRole("link", { name: "Sign in to StudyFlow" });
    await link.waitFor();
    assert.match(await link.getAttribute("href"), /^\/auth\?next=.*trust%3D1$/);
  });
});
