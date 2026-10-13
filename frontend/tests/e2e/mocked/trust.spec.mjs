import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";
import { enrolledPlanner } from "../plannerMock.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test.describe("permissions and activity preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows tiers, credit multiplier, limits, approvals and audit log read-only at phone width", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?trust=preview`);
    await page.getByRole("heading", { name: "Credit record" }).waitFor();
    for (const tier of ["T0", "T1", "T2", "T3"]) await page.locator(`.tier-legend .tier-${tier.toLowerCase()}`).waitFor();
    await page.getByText("×1.2").waitFor();
    await page.getByText("Your T2 limits are the base limits × 1.2, set by this level.").waitFor();
    await page.getByRole("tab", { name: "Limits" }).click();
    await page.locator("#trust-limits .panel-hero", { hasText: "CNY 12,000.00" }).waitFor();
    await page.locator("#trust-approvals li", { hasText: /Submit transfer.*CNY 15,000\.00.*Waiting for an operator/ }).waitFor();
    await page.getByRole("tab", { name: "Activity" }).click();
    await page.getByRole("cell", { name: /Password re-check passed/ }).waitFor();
    await page.getByRole("combobox", { name: "Show" }).selectOption("approval");
    assert.equal(await page.locator("#trust-audit tbody tr").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("combobox", { name: "Show" }).selectOption("all");
    await page.screenshot({ path: screenshot("trust-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "信用记录" }).waitFor();
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
    await enrolledPlanner(page);
    await page.goto(`${base}/?trust=1`);
    await page.getByRole("heading", { name: "Credit record" }).waitFor();
    await page.locator("#trust-credit").getByText("Injected profile failure", { exact: false }).waitFor();
    await page.getByRole("tab", { name: "Limits" }).click();
    await page.locator("#trust-limits .panel-hero", { hasText: /THB 75,000\.00.*base THB 50,000\.00/ }).waitFor();
    await page.getByText("Effective limit = base limit × 1.5.", { exact: false }).waitFor();
    await page.getByText("No approval requests.").waitFor();
    await page.getByRole("tab", { name: "Activity" }).click();
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

  test("signed-out students cannot open the credit record and are offered the StudyFlow sign-in page", async ({ page }) => {
    // Signed out, the planner cannot load, so the workspace counts the student as not enrolled:
    // the enrollment gate closes the credit tool and the conversation offers the sign-in link instead.
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    let apiCalls = 0;
    await page.route("**/api/v2/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?trust=1`);
    await page.getByRole("status").filter({ hasText: "That tool opens once enrollment is confirmed." }).waitFor();
    assert.equal(await page.locator("section.workspace-dock").isVisible(), false);
    assert.equal(await page.locator("#trust-tiers").count(), 0);
    const link = page.getByRole("link", { name: "Sign in to StudyFlow" });
    await link.waitFor();
    assert.match(await link.getAttribute("href"), /^\/auth\?next=/);
    assert.equal(apiCalls, 0);
  });
});
