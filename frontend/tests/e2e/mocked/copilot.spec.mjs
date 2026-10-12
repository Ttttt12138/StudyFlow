import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test.describe("what-if planner preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows two compared scenarios, a blocked apply, review, notifications and a trace without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?copilot=preview`);
    await page.getByRole("heading", { name: "Build scenarios" }).waitFor();
    const results = page.locator("#copilot-results");
    await results.getByRole("columnheader", { name: "Parents add THB 20,000; tuition instalment" }).waitFor();
    await results.getByRole("columnheader", { name: "Borrow THB 30,000 over 12 months" }).waitFor();
    await results.getByText(/vs current \(better\)/).first().waitFor();
    await results.getByText(/Tuition is verified or locked/).waitFor();
    await results.getByText("Not enough data").waitFor();
    const apply = page.locator("#copilot-apply");
    await apply.getByText("Cannot be applied yet").waitFor();
    await apply.getByRole("link", { name: "See your review items" }).waitFor();
    await page.locator("#copilot-review").getByRole("heading", { name: "Protected cost change" }).waitFor();
    await page.locator("#copilot-notifications").getByText("Unread: 1.").waitFor();
    await page.locator("#copilot-why").getByText("Blocked", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Compare", exact: true }).isDisabled(), true);
    assert.equal(await results.getByRole("button", { name: "Preview applying" }).first().isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("copilot-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "构建方案" }).waitFor();
    await page.getByRole("heading", { name: "你的复核事项" }).waitFor();
    await page.locator("#copilot-apply").getByText("暂时无法应用").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("copilot-preview-mobile-zh.png"), fullPage: true });
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("what-if planner with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("compares with the version tuple, applies with the confirmation token, rechecks a review and reads a notification", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const sem = "00000000-0000-4000-8000-000000005e01";
    const source = "00000000-0000-4000-8000-00000000f001";
    const runId = "00000000-0000-4000-8000-00000000a1f0";
    const versions = { state_version: 8, budget_version: 5, analysis_version: 0 };
    const state = () => ({ ...versions, semester_id: sem, assets: { balance_as_of: "2026-10-01", currency: "THB" }, reserve: "1000.00",
      estimated_expenses: [{ cost_id: "housing", category: "housing", amount: "7000.00", currency: "THB", period: "monthly", paid: false, applicability: "APPLICABLE" }],
      expected_income: [{ id: source, kind: "family", amount: "15000.00", currency: "THB", available_on: "2026-11-20", received: false }] });
    const metrics = (gap, min) => ({ maximum_reserve_gap: gap, minimum_balance: min, first_below_reserve: gap === "0.00" ? null : "2026-11-01", first_negative_date: null,
      remaining_expenses: "8000.00", semester_funding_gap: "0.00", complete: true, issues: [], monthly: [{ month: "2026-11", ending_balance: min, minimum_balance: min }] });
    const result = (name, gap, min, extra = {}) => ({ ...metrics(gap, min), name, conditional: true, conditions: ["HYPOTHETICAL_FUNDING_NOT_SETTLED"],
      confirmed: metrics("5000.00", "-4000.00"), loan: null, loan_needed: gap, unmet_gap: gap, ...extra });
    const run = { id: runId, stale: false, applied_index: null, application: {}, baseline: result("Current plan", "5000.00", "-4000.00", { conditions: [] }),
      scenarios: [
        result("Cheaper housing", "0.00", "1000.00", { delta: { maximum_reserve_gap: "-5000.00", minimum_balance: "5000.00", remaining_expenses: "-3000.00", loan_needed: "-5000.00" } }),
        result("Loan", "0.00", "25000.00", { delta: { maximum_reserve_gap: "-5000.00", minimum_balance: "29000.00", remaining_expenses: "0.00", loan_needed: "0.00" },
          loan: { principal: "30000.00", net_proceeds: "29400.00", fees: "600.00", total_interest: "818.64", total_repayment: "30818.64", maximum_installment: "2568.22",
            repayments: [{ number: 1, due_date: "2027-01-15", amount: "2568.22" }], affordability: { status: "AFFORDABLE", missing_inputs: [], shortfall_months: [] } } }),
      ] };
    const housing = { cost_id: "housing", amount: "7000.00", currency: "THB", period: "monthly" };
    const diff = [
      { kind: "cost", id: "housing", before: housing, after: { ...housing, planned_overrides: [{ amount: "4000.00", effective_on: "2026-11-01" }] } },
      { kind: "family_support", id: null, before: null, after: { amount: "20000.00", available_on: "2026-11-25", currency: "THB", certainty: "estimated", status: "PENDING" } },
    ];
    const review = { id: "00000000-0000-4000-8000-00000000e001", key: "k", kind: "protected_cost", entity_id: runId, status: "OPEN", version: 2, assignee: null,
      updated_at: "2026-10-02T00:00:00Z", details: { blockers: [{ cost_id: "housing", proposed: { amount: "4000.00" } }], next_action: "Confirm replacement evidence" } };
    const notes = [
      { id: "00000000-0000-4000-8000-00000000b001", created_at: "2026-10-01T00:00:00Z", transition: "NEW", read_at: null, payload: { kind: "reserve_gap" } },
      { id: "00000000-0000-4000-8000-00000000b002", created_at: "2026-10-02T00:00:00Z", transition: "RESOLVED", read_at: "2026-10-03T00:00:00Z", payload: { kind: "payment_due" } },
    ];
    let compareAttempts = 0;
    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        posts.push(path);
        assert.ok(request.headers()["idempotency-key"]);
        if (path === "readiness/what-if/") {
          compareAttempts++;
          // The first attempt races a plan change: Django answers 409 and the next attempt carries the new tuple.
          if (compareAttempts === 1) { versions.state_version = 9; return json(route, 409, { detail: "Version conflict", code: "VERSION_CONFLICT" }); }
          assert.deepEqual(body, { semester_id: sem, state_version: 9, budget_version: 5, analysis_version: 0, scenarios: [
            { name: "Cheaper housing", costs: [{ cost_id: "housing", amount: "4000.00", effective_on: "2026-11-01" }],
              family_support: [{ amount: "20000.00", available_on: "2026-11-25" }, { source_id: source, amount: "10000.00", available_on: "2026-12-01" }], allow_new_loan: true },
            { name: "Loan", allow_new_loan: true, loan: { currency: "THB", principal: "30000.00", annual_rate: "0.05", fees: "600.00", months: 12, first_due_date: "2027-01-15" },
              loan_available_on: "2026-11-25" },
          ] });
          return json(route, 201, { data: run });
        }
        if (path === `readiness/what-if/${runId}/apply-preview/`) {
          assert.deepEqual(body, { scenario_index: 0 });
          return json(route, 201, { data: { scenario_index: 0, diff, blockers: [], confirmation: "signed-token", expires_in_seconds: 900 } });
        }
        if (path === `readiness/what-if/${runId}/apply/`) {
          assert.deepEqual(body, { confirmation: "signed-token" });
          const application = { status: "APPLIED", run_id: runId, before: { state_version: 9, budget_version: 5 }, after: { state_version: 10, budget_version: 6 }, diff,
            support_requests: [{ id: "sr1", amount: "20000.00", status: "PENDING" }], loan: null };
          Object.assign(run, { applied_index: 0, application });
          return json(route, 201, { data: application });
        }
        if (path === `review-queue/${review.id}/actions/`) {
          assert.deepEqual(body, { expected_version: 2, action: "recheck", reason: "Landlord letter confirmed" });
          Object.assign(review, { status: "RESOLVED", version: 3 });
          return json(route, 201, { data: review });
        }
        if (path === `readiness/notifications/${notes[0].id}/read/`) {
          assert.deepEqual(body, {});
          notes[0].read_at = "2026-10-12T00:00:00Z";
          return json(route, 201, { data: notes[0] });
        }
        return json(route, 500, { detail: `unexpected POST ${path}` });
      }
      if (path === "readiness/state/") return json(route, 200, { data: state() });
      if (path === "review-queue/") return json(route, 200, { data: { count: 1, items: [review], next: null, previous: null } });
      if (path === `review-queue/${review.id}/`) return json(route, 200, { data: { ...review, history: [] } });
      if (path === "readiness/notifications/") return json(route, 200, { data: notes, unread_count: notes.filter(n => !n.read_at).length, count: 2, next: null, previous: null });
      if (path === `readiness/what-if/${runId}/`) return json(route, 200, { data: run });
      return json(route, 404, { detail: path });
    });
    await page.goto(`${base}/?copilot=1`);
    await page.getByText("Comparing against plan versions: state 8, budget 5, analysis 0.").waitFor();

    const first = page.locator("fieldset.copilot-form").nth(0);
    await first.getByLabel("Scenario name").fill("Cheaper housing");
    await first.getByRole("button", { name: "Add cost change" }).click();
    await first.getByRole("combobox", { name: /^Cost/ }).selectOption("housing");
    await first.getByText("Current: THB 7,000.00 / month").waitFor();
    await first.getByLabel("New amount (THB)").fill("4000");
    await first.getByLabel("Effective from").fill("2026-11-01");
    await first.getByRole("button", { name: "Add family support" }).click();
    await first.getByRole("button", { name: "Add family support" }).click();
    const support = first.getByRole("group", { name: /Family support/ });
    await support.nth(0).getByLabel("Amount (THB)").fill("20000");
    await support.nth(0).getByLabel("Available on").fill("2026-11-25");
    await support.nth(1).getByRole("combobox", { name: /^Support/ }).selectOption(source);
    await support.nth(1).getByLabel("Amount (THB)").fill("10000");
    await support.nth(1).getByLabel("Available on").fill("2026-12-01");

    await page.getByRole("button", { name: "Add scenario" }).click();
    const second = page.locator("fieldset.copilot-form").nth(1);
    await second.getByLabel("Scenario name").fill("Loan");
    await second.getByLabel("Principal (THB)").fill("30000");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    // Loan terms are all-or-nothing: the partial loan is caught before any request.
    await second.getByText(/Loan terms are all-or-nothing/).waitFor();
    assert.equal(posts.length, 0);
    await second.getByLabel("Annual rate (%)").fill("5");
    await second.getByLabel("Fees (THB)").fill("600");
    await second.getByLabel("Months (1–60)").fill("12");
    await second.getByLabel("Loan received on").fill("2026-11-25");
    await second.getByLabel("First repayment due").fill("2027-01-15");

    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await page.getByText(/This changed since the page loaded/).waitFor();
    await page.getByText("Comparing against plan versions: state 9, budget 5, analysis 0.").waitFor();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await page.getByText("Comparison ready. Nothing in your plan has changed.").waitFor();
    assert.match(page.url(), new RegExp(`run=${runId}`));
    const results = page.locator("#copilot-results");
    await results.getByRole("columnheader", { name: "Cheaper housing" }).waitFor();
    await results.locator(".copilot-better").first().waitFor();
    await results.getByText("Affordable", { exact: true }).waitFor();

    await results.getByRole("button", { name: "Preview applying" }).first().click();
    const apply = page.locator("#copilot-apply");
    await apply.getByText(/is created as PENDING. No link is sent to anyone/).waitFor();
    await apply.getByText("No money moves and no payment is made.").waitFor();
    const confirm = apply.getByRole("button", { name: "Apply to my plan" });
    assert.equal(await confirm.isDisabled(), true);
    await apply.getByLabel("I confirm applying exactly these changes to my plan.").check();
    await confirm.click();
    await page.getByText("Scenario applied to your plan. No money moved.").waitFor();
    await apply.getByText("Plan state version 9 → 10; budget version 5 → 6.").waitFor();
    assert.equal(await apply.getByRole("link", { name: "Open Family support" }).getAttribute("href"), "?family=1");

    const reviewCard = page.locator("#copilot-review");
    await reviewCard.getByLabel("Reason for recheck").fill("Landlord letter confirmed");
    await reviewCard.getByRole("button", { name: "Ask for a recheck" }).click();
    await page.getByText("Recheck done. Status: Resolved.").waitFor();

    const notifications = page.locator("#copilot-notifications");
    await notifications.getByText("Unread: 1.").waitFor();
    await notifications.getByRole("button", { name: "Mark as read" }).click();
    await notifications.getByText("Unread: 0.").waitFor();

    assert.deepEqual(posts, ["readiness/what-if/", "readiness/what-if/", `readiness/what-if/${runId}/apply-preview/`, `readiness/what-if/${runId}/apply/`,
      `review-queue/${review.id}/actions/`, `readiness/notifications/${notes[0].id}/read/`]);
    assert.deepEqual(errors, []);
  });
});
