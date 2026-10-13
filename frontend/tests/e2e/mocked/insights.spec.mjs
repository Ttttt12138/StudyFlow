import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test.describe("insights preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows every section read-only at phone width without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?insights=preview`);
    await page.getByRole("heading", { name: "Spending insights", level: 2 }).waitFor();
    await page.locator(".workspace-preview").getByText("Demo preview · read-only").waitFor();
    const tab = name => page.getByRole("tab", { name }).click();
    // The pending import is announced on the overview and reviewed in a sheet.
    await page.getByRole("button", { name: "Review now" }).click();
    const review = page.locator(".insights-review");
    await page.getByRole("dialog").getByRole("heading", { name: /Review import from/ }).waitFor();
    await review.getByText("Already imported", { exact: true }).waitFor();
    await review.getByText("Suspected duplicate", { exact: true }).waitFor();
    await review.getByText("Invalid rows (not imported)").waitFor();
    await review.getByText("5 of 7 rows selected.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Confirm import" }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Import CSV" }).click();
    assert.equal(await page.getByRole("button", { name: "Upload and preview" }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await tab("Forecast");
    const costs = page.locator("#insights-forecast li");
    await costs.filter({ hasText: "Food" }).filter({ hasText: "THB 3,000.00 → THB 4,310.00" }).filter({ hasText: "Applied" }).waitFor();
    await costs.filter({ hasText: "Housing" }).filter({ hasText: "contract or locked cost" }).waitFor();
    await tab("Transactions");
    await page.locator("#insights-transactions").getByText("Campus Print").waitFor();
    await tab("Categories");
    await page.locator("#insights-categories").getByRole("img", { name: "Spending by category" }).waitFor();
    await page.locator("#insights-recurring").getByText("Demo Condo").waitFor();
    await tab("Overview");
    await page.locator("#insights-risks").getByRole("heading", { name: "Spending is higher than planned" }).waitFor();
    await page.locator("#insights-risks").getByText("Resolved (1)").waitFor();
    assert.equal(await page.getByRole("button", { name: "Run a readiness check now" }).isDisabled(), true);
    await page.getByRole("button", { name: "Check history" }).click();
    await page.locator("#insights-checks").getByText("Will retry").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("insights-preview-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "消费洞察", level: 2 }).waitFor();
    await page.getByRole("heading", { name: "支出高于计划" }).waitFor();
    await page.getByRole("button", { name: "导入 CSV" }).click();
    await page.getByRole("heading", { name: "导入银行交易" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("insights-preview-mobile-zh.png"), fullPage: true });
    await page.getByRole("button", { name: "English" }).click().catch(() => {});
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("insights with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("CSV upload → review → coverage → confirm → recalculation → forecast changes, then a category fix", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const list = results => ({ count: results.length, next: null, previous: null, results });
    const versions = { semester_id: "s1", state_version: 3, budget_version: 2, analysis_version: 4 };
    const row = (n, date, amount, counterparty, description, category, extra = {}) => ({ locator: `row:${n}`, transaction_id: `t${n}`, account_id: "demo-main", date, amount,
      currency: "THB", counterparty, description, status: "READY", duplicate: false, suspected_duplicate: false, classification: { category, basis: "rule", confidence: 0.85 }, ...extra });
    const batch = { id: "00000000-0000-4000-8000-0000000000b1", created_at: "2026-10-11T03:00:00Z", sha256: "abc", source_type: "synthetic", status: "NEEDS_REVIEW", confirmation: {},
      preview: { rows: [row(2, "2026-09-02", "-142.00", "Demo Cafe", "Food", "Food"), row(3, "2026-09-03", "-118.00", "Demo Cafe", "Food", "Food", { transaction_id: null, suspected_duplicate: true }),
        row(4, "2026-09-10", "-640.00", "Campus Print", "Posters", "Other")], issues: [] } };
    const tx = { id: "00000000-0000-4000-8000-0000000000c1", created_at: "2026-10-11T03:01:00Z", account: "a1", batch: batch.id, external_id: "t4", locator: "row:4", date: "2026-09-10",
      amount: "-640.00", currency: "THB", counterparty: "Campus Print", description: "Posters", category: "Other", classification: {}, needs_review: true, cost_id: "", refund_of: null };
    let imports = [], confirmed = false, checkReads = 0;
    const posts = [];
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v2/", "");
      if (request.method() === "POST") {
        posts.push(path);
        assert.ok(request.headers()["idempotency-key"], `idempotency key on ${path}`);
        if (path === "readiness/transaction-imports/") {
          assert.match(request.headers()["content-type"], /^multipart\/form-data; boundary=/);
          const body = request.postData();
          assert.match(body, /name="source_type"\r\n\r\nsynthetic\r\n/);
          if (body.includes('filename="bad.csv"')) return json(route, 400, { detail: "CSV_MISSING_COLUMNS", code: "CSV_MISSING_COLUMNS", message: "Csv missing columns." });
          assert.match(body, /name="file"; filename="history\.csv"\r\nContent-Type: text\/csv\r\n\r\ntransaction_id,account_id,date/);
          imports = [batch];
          return json(route, 202, { data: batch });
        }
        if (path === `readiness/transaction-imports/${batch.id}/confirm/`) {
          assert.deepEqual(request.postDataJSON(), {
            selected_rows: ["row:2", "row:3", "row:4"], keep_similar_rows: ["row:3"],
            coverage: [{ account_id: "demo-main", start: "2026-09-01", end: "2026-09-30", complete: true }],
          });
          confirmed = true;
          imports = [{ ...batch, status: "COMMITTED", confirmation: request.postDataJSON() }];
          return json(route, 201, { data: { ...imports[0], analysis_version: 5, is_simulated: true } });
        }
        if (path === `readiness/transactions/${tx.id}/revise/`) {
          assert.deepEqual(request.postDataJSON(), { category: "Food", cost_id: "food", reason: "Lunch, not printing" });
          Object.assign(tx, { category: "Food", cost_id: "food", needs_review: false });
          return json(route, 201, { data: tx });
        }
        return json(route, 500, { detail: `unexpected POST ${path}` });
      }
      if (path === "readiness/state/") return json(route, 200, { data: { ...versions, analysis_version: confirmed ? 5 : 4, assets: { currency: "THB", balance_as_of: "2026-10-01" },
        estimated_expenses: [{ cost_id: "food", category: "food", amount: "3000.00" }, { cost_id: "housing", category: "housing", amount: "9000.00" }] } });
      if (path === "demo/wallets/") return json(route, 200, list([{ clock: "2026-10-11" }]));
      if (path === "readiness/transaction-imports/") return json(route, 200, list(imports));
      if (path === "readiness/transactions/") return json(route, 200, list(confirmed ? [tx] : []));
      if (path === "readiness/recurring-expenses/" || path === "readiness/risks/") return json(route, 200, list([]));
      if (path === "readiness/checks/") {
        if (!confirmed) return json(route, 200, list([]));
        checkReads++;
        const status = checkReads === 1 ? "QUEUED" : "DONE";
        return json(route, 200, list([{ id: "j2", created_at: "2026-10-11T03:02:00Z", kind: "check", status, attempts: status === "DONE" ? 1 : 0, error_code: "", payload: { trigger: "consumption_changed", ...versions, analysis_version: 5 } },
          { id: "j1", created_at: "2026-10-11T01:00:00Z", kind: "check", status: "DONE", attempts: 1, error_code: "", payload: { trigger: "manual", ...versions } }]));
      }
      if (path === "readiness/briefing/") return json(route, 200, { data: { status: "SAFE", as_of: "2026-10-11", ...versions, earliest_risk_date: null, risks: {},
        forecast_changes: confirmed && checkReads > 1 ? { complete_months: ["2026-09"], unresolved_transactions: false, costs: [
          { cost_id: "food", category: "food", original_amount: "3000.00", suggested_monthly: "900.00", forecast_amount: "900.00", applied: true, reason: "MONTHLY_MEDIAN", sample_months: 1 },
          { cost_id: "housing", category: "housing", original_amount: "9000.00", suggested_monthly: null, forecast_amount: "9000.00", applied: false, reason: "LOCKED_OR_CONTRACTUAL", sample_months: 1 }] } : {} } });
      return json(route, 404, { detail: path });
    });

    await page.goto(`${base}/?insights=1`);
    await page.getByRole("heading", { name: "Spending insights", level: 2 }).waitFor();
    const tab = name => page.getByRole("tab", { name }).click();
    await tab("Forecast");
    await page.getByText("No forecast changes yet.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Import CSV" }).click();
    await page.getByLabel("Where the file comes from").selectOption("synthetic");

    // A file-level error is explained in plain words.
    await page.getByLabel("CSV file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") });
    await page.getByRole("button", { name: "Upload and preview" }).click();
    await page.getByRole("alert").filter({ hasText: "The CSV is missing required columns." }).waitFor();

    await page.getByLabel("CSV file").setInputFiles({ name: "history.csv", mimeType: "text/csv", buffer: Buffer.from("transaction_id,account_id,date,amount,currency,counterparty,description\n") });
    await page.getByRole("button", { name: "Upload and preview" }).click();
    await page.getByText("File read: 3 rows to review, 0 invalid.").waitFor();
    const review = page.locator(".insights-review");
    await review.getByText("2 of 3 rows selected.").waitFor();
    assert.equal(await review.getByLabel("Import row:3").isChecked(), false);
    await review.getByLabel("Keep row:3 even though it looks like a duplicate").check();
    await review.getByText("3 of 3 rows selected.").waitFor();
    await review.getByRole("button", { name: "Coverage per account" }).click();
    // Defaults come from the selected rows; widen them to the whole month and declare it complete.
    assert.equal(await review.getByLabel("From", { exact: true }).inputValue(), "2026-09-02");
    assert.equal(await review.getByLabel("To", { exact: true }).inputValue(), "2026-09-10");
    await review.getByLabel("From", { exact: true }).fill("2026-09-01");
    await review.getByLabel("To", { exact: true }).fill("2026-09-30");
    await review.getByLabel("This file is complete for this period").check();
    await page.getByRole("button", { name: "Confirm import" }).click();
    await page.getByText("Import confirmed: 3 rows added.").waitFor();
    await page.getByText("Recalculating your forecast…").waitFor();
    await page.getByText("Forecast recalculated.").waitFor({ timeout: 15_000 });
    const costs = page.locator("#insights-forecast li");
    await costs.filter({ hasText: "Food" }).filter({ hasText: "THB 3,000.00 → THB 900.00" }).filter({ hasText: "Applied" }).filter({ hasText: "Median of complete months" }).waitFor();
    await costs.filter({ hasText: "Housing" }).filter({ hasText: "Not changed: contract or locked cost" }).waitFor();
    await tab("Overview");
    await page.getByRole("button", { name: "Check history" }).click();
    await page.locator("#insights-checks").getByText("Transactions changed").waitFor();
    await page.keyboard.press("Escape");

    // Fix the category of a transaction that needs review.
    await tab("Transactions");
    const txs = page.locator("#insights-transactions");
    await txs.getByLabel("Only those needing review").check();
    await txs.getByRole("button", { name: /Change category of Campus Print/ }).click();
    const sheet = page.getByRole("dialog", { name: "Change category" });
    await sheet.locator("form").getByLabel(/^Category/).selectOption("Food");
    await sheet.getByLabel("Count it towards cost (optional)").selectOption("food");
    await sheet.getByLabel("Why (kept in the audit trail)").fill("Lunch, not printing");
    await sheet.getByRole("button", { name: "Save category" }).click();
    await page.getByText("Category saved. The forecast will be recalculated.").waitFor();
    await txs.getByText("No transactions match.").waitFor();

    assert.deepEqual(posts, ["readiness/transaction-imports/", "readiness/transaction-imports/", `readiness/transaction-imports/${batch.id}/confirm/`, `readiness/transactions/${tx.id}/revise/`]);
    assert.deepEqual(errors, []);
  });

  test("a 409 on running a check refreshes and says the data changed", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "t" } }));
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    let stateVersion = 3, checkBody = null;
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      if (request.method() === "POST" && path === "readiness/checks/") {
        checkBody = request.postDataJSON();
        stateVersion = 4;
        return json(route, 409, { detail: "VERSION_CONFLICT", code: "VERSION_CONFLICT", message: "Changed." });
      }
      if (path === "readiness/state/") return json(route, 200, { data: { semester_id: "s1", state_version: stateVersion, budget_version: 2, analysis_version: 1, assets: { currency: "THB" }, estimated_expenses: [] } });
      if (path === "readiness/briefing/") return json(route, 200, { data: { status: "NEEDS_INFORMATION", as_of: "2026-10-11", risks: {}, forecast_changes: {} } });
      return json(route, 200, { count: 0, next: null, previous: null, results: [] });
    });
    await page.goto(`${base}/?insights=1`);
    await page.getByRole("button", { name: "Run a readiness check now" }).click();
    await page.getByRole("alert").filter({ hasText: "This changed since the page loaded." }).waitFor();
    assert.deepEqual(checkBody, { semester_id: "s1", state_version: 3, budget_version: 2, analysis_version: 1 });
  });

  test("signed out shows the sign-in card", async ({ page }) => {
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
    await page.goto(`${base}/?insights=1`);
    await page.getByText("Sign in to import transactions and see your spending insights.").waitFor();
  });
});
