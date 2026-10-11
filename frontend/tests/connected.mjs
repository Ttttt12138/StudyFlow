import { chromium } from "playwright";
import assert from "node:assert/strict";
import { executablePath, screenshot } from "./support.mjs";
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const requests = [];
let version = 1,
  budgetVersion = 1,
  semester = null,
  importReads = 0,
  budgetFails = 1,
  budgetKey = null,
  appFails = 1,
  appKey = null,
  app = null;
let forecastRun = null;
let fundingRun = null;
let fundingPlanRun = null;
const fundingSources = [];
const loanQuotes = [{ id: "quote-older", inputs: { currency: "THB", principal: "5000.00", annual_rate: "0.10", fees: "400.00", months: 12, first_due_date: "2027-02-01" }, result: { currency: "THB", net_proceeds: "4600.00", total_repayment: "5500.00", repayments: [{ due_date: "2027-02-01", amount: "458.33" }] } }];
const draft = {
  profile: {
    school: "PSU",
    campus: "Phuket",
    program: "International Business",
    semester: "2026-1",
    start_date: "2026-08-10",
    end_date: "2026-12-15",
  },
  costs: [
    {
      cost_id: "tuition",
      component: "Tuition",
      category: "tuition",
      amount: "41000.00",
      currency: "THB",
      period: "semester",
      due_date: "2026-08-10",
      paid: false,
      confidence_type: "UNCONFIRMED",
      evidence: [],
      source_refs: [],
    },
    {
      cost_id: "food",
      component: "Food",
      category: "food",
      amount: null,
      currency: "THB",
      period: "monthly",
      paid: false,
      confidence_type: "UNCONFIRMED",
      evidence: [],
      source_refs: [],
    },
  ],
  reserve: null,
  required_categories: ["tuition", "food"],
};
const budget = () => ({
  low: "41000.00",
  base: "41000.00",
  high: "41000.00",
  remaining_base: "41000.00",
  gap: "0.00",
  currency: "THB",
  complete: false,
  sufficient: false,
  issues: ["MISSING:food"],
  assumptions: ["Mock contract"],
  state_version: version,
  budget_version: budgetVersion,
  semester_id: "semester-1",
});
const state = () => ({
  semester_id: "semester-1",
  state_version: version,
  budget_version: budgetVersion,
  analysis_version: 1,
  assets: {
    planning_balance: "50000.00",
    wallet_balance: null,
    currency: "THB",
    basis: "USER_DECLARED",
  },
  budget: budget(),
  estimated_expenses: semester?.draft.costs ?? [],
  expected_income: [],
});
const json = (route, status, object) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(object),
  });
await page.route("**/api/auth/session/", route => json(route, 200, {authenticated: true, username: "test-student", csrf_token: "mock-csrf"}));
await page.route("**/api/v2/**", async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname.replace("/api/v2/", "");
  const method = req.method();
  const body =
    method === "POST" && (req.headers()["content-type"] ?? "").includes("json")
      ? req.postDataJSON()
      : null;
  requests.push({ path, method, body, key: req.headers()["idempotency-key"] });
  assert.equal(req.headers().authorization, undefined);
  if (method === "POST") assert.equal(req.headers()["x-csrftoken"], "mock-csrf");
  if (method === "POST") assert.ok(req.headers()["idempotency-key"]);
  if (path === "readiness/imports/" && method === "GET") return json(route, 200, {data: []});
  if (path === "readiness/imports/ocr-notice/") return json(route, 200, {data: {version: "ocr-v1", enabled: false, configured: false, policy_configured: false}});
  if (path === "affordability-profile/" && method === "GET") return json(route, 200, {data: {version: 0, months: []}});
  if (path === "applications/" && method === "GET") return json(route, 200, {results: app ? [app] : []});
  if (path === "readiness/budgets/" && method === "GET") return json(route, 200, {data: []});
  if (path === "readiness/templates/" && method === "GET")
    return json(route, 200, {
      data: [{ key: "psu-phuket-fis-ib-2026-1-shared", version: 1, ...draft }],
    });
  if (path === "readiness/state/" && method === "GET")
    return semester
      ? json(route, 200, { data: state() })
      : json(route, 400, { detail: "NO_ACTIVE_SEMESTER" });
  if (path === "readiness/semesters/" && method === "POST") {
    semester = { id: "semester-1", version: 1, draft: structuredClone(draft) };
    return json(route, 201, { data: { ...semester, state_version: version } });
  }
  if (path === "readiness/semesters/semester-1/" && method === "GET")
    return json(route, 200, { data: semester });
  if (path === "funding-sources/" && method === "GET")
    return json(route, 200, { count: fundingSources.length, results: fundingSources });
  if (path === "readiness/forecasts/" && method === "GET")
    return json(route, 200, { data: forecastRun ? [forecastRun] : [] });
  if (path === "readiness/funding-plans/recommend/" && method === "GET")
    return json(route, 200, { data: fundingRun ? [fundingRun] : [] });
  if (path === "readiness/funding-plans/" && method === "GET")
    return json(route, 200, { data: fundingPlanRun ? [fundingPlanRun] : [] });
  if (path === "loans/" && method === "GET")
    return json(route, 200, { count: loanQuotes.length,
      results: new URL(req.url()).searchParams.get("page") === "2" ? loanQuotes.slice(1) : loanQuotes.slice(0, 1),
      next: !new URL(req.url()).searchParams.has("page") && loanQuotes.length > 1 ? new URL("/api/v2/loans/?page=2", req.url()).href : null,
    });
  if (path === "readiness/imports/" && method === "POST")
    return json(route, 202, {
      data: {
        id: "import-1",
        status: "QUEUED",
        job_status: "QUEUED",
        error_code: null,
        result: {},
      },
    });
  if (path === "readiness/imports/import-1/" && method === "GET") {
    importReads++;
    return json(route, 200, {
      data: {
        id: "import-1",
        status: "NEEDS_REVIEW",
        job_status: "DONE",
        error_code: null,
        result: {
          draft: structuredClone(draft),
          proposed_draft: {
            ...structuredClone(draft),
            costs: draft.costs.map((c) => ({
              ...c,
              source_refs: ["import-1"],
            })),
          },
          merge_conflicts: { "profile.school": ["PSU", "Other University"] },
          issues: [],
        },
      },
    });
  }
  if (path === "readiness/imports/import-1/confirm/" && method === "POST") {
    assert.equal(body.issuer, "PSU");
    assert.ok(body.conflict_resolutions["profile.school"]);
    assert.deepEqual(body.selected_cost_ids, ["tuition", "food"]);
    semester.draft = body.draft;
    version++;
    budgetVersion++;
    semester.version = budgetVersion;
    return json(route, 201, { data: { status: "COMMITTED", semester } });
  }
  if (path === "readiness/semesters/revise/" && method === "POST") {
    assert.equal(body.state_version, version);
    assert.equal(body.budget_version, budgetVersion);
    semester.draft = body.draft;
    version++;
    budgetVersion++;
    semester.version = budgetVersion;
    return json(route, 201, { data: { ...semester, state_version: version } });
  }
  if (path === "readiness/budgets/" && method === "POST") {
    if (budgetFails--) {
      budgetKey = req.headers()["idempotency-key"];
      return json(route, 503, { detail: "Temporary backend failure" });
    }
    assert.equal(req.headers()["idempotency-key"], budgetKey);
    return json(route, 201, {
      data: {
        id: "budget-1", analysis_version: 1,
        state_version: version,
        budget_version: budgetVersion,
        result: budget(),
      },
    });
  }
  if (path === "readiness/forecasts/" && method === "POST") {
    assert.equal(body.horizon, 90);
    assert.equal(body.conditional, false);
    assert.equal(body.state_version, version);
    const missingFood = semester.draft.costs.find((cost) => cost.cost_id === "food")?.amount == null;
    forecastRun = {
      id: "forecast-1", state_version: version, budget_version: budgetVersion,
      analysis_version: 1,
      result: {
        currency: "THB", end_date: "2026-10-29", status: "complete_under_assumptions",
        complete: !missingFood, conditional: false, first_gap_date: "2026-08-10",
        maximum_reserve_gap: "7000.00", ending_balance: "8000.00",
        missing_event_ids: missingFood ? ["cost:food"] : [], excluded_unconfirmed_income: [],
        budget_issues: missingFood ? ["MISSING:food"] : [],
        assumptions: ["Server calculation"],
        timeline: [{ id: "cost:tuition:2026-08-10", date: "2026-08-10", label: "Tuition",
          kind: "expense", amount: "42000.00", certainty: "confirmed",
          balance_after: "8000.00", reserve_gap: "7000.00" }],
      },
    };
    return json(route, 201, { data: forecastRun });
  }
  if (path === "funding-sources/" && method === "POST")
    return json(route, 201, {
      data: (fundingSources.push({ id: "source-1", ...body, received: false }), fundingSources.at(-1)),
    });
  if (path === "readiness/funding-plans/recommend/" && method === "POST") {
    fundingRun = {
        id: "funding-1", analysis_version: 1,
        state_version: version,
        budget_version: budgetVersion,
        result: {
          recommended_borrowing_net: "10000.00",
          quote_required: true,
          assumptions: [],
          is_recommendation_final: false,
          nonloan_plan: {
            validation: "CONDITIONAL",
            remaining_gap: "10000.00",
            conditions: ["Family funds not received"],
            allocations: [{ source_id: "source-1", amount: "10000.00" }],
            affordability: "SEE_B_QUOTE",
          },
        },
    };
    return json(route, 201, { data: fundingRun });
  }
  if (path === "readiness/funding-plans/" && method === "POST") {
    assert.deepEqual(body.allocations, [{ source_id: "source-1", amount: "10000.00" }]);
    fundingPlanRun = { id: "plan-1", analysis_version: 1, state_version: version, budget_version: budgetVersion, result: { validation: "CONDITIONAL", remaining_gap: "10000.00" } };
    return json(route, 201, { data: fundingPlanRun });
  }
  if (path === "loans/" && method === "POST") {
    const quote = { id: "quote-1", inputs: body, result: { currency: "THB", net_proceeds: "10000.00", total_interest: "662.00", total_repayment: "10662.00", repayments: [{ due_date: body.first_due_date, amount: "888.50" }] } };
    loanQuotes.push(quote);
    return json(route, 201, { data: quote });
  }
  if (path === "applications/" && method === "POST") {
    app = { id: "app-1", status: "DRAFT", version: 1, quote_id: body.quote_id };
    return json(route, 201, { data: app });
  }
  if (path === "applications/app-1/action/" && method === "POST") {
    assert.deepEqual(body, { expected_version: 1, action: "submit" });
    if (appFails--) {
      appKey = req.headers()["idempotency-key"];
      return json(route, 503, { detail: "Temporary failure" });
    }
    assert.equal(req.headers()["idempotency-key"], appKey);
    app = {
      ...app,
      status: "UNDER_REVIEW",
      version: 2,
      assessment: { status: "INSUFFICIENT_DATA" },
    };
    return json(route, 201, { data: app });
  }
  if (path === "applications/app-1/" && method === "GET")
    return json(route, 200, { data: app });
  return json(route, 404, { detail: path });
});
try {
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "Create a semester" }).waitFor();
  await page.getByLabel("Opening balance (THB)").fill("50000.00");
  await page.getByLabel("Balance as of").fill("2026-08-01");
  await page.getByRole("button", { name: "Create semester" }).click();
  await page.getByRole("heading", { name: "Check your school and dates" }).waitFor();
  await page.getByLabel("Admission document").setInputFiles({
    name: "offer.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Tuition THB 41000"),
  });
  await page.getByRole("button", { name: "Upload for extraction" }).click();
  await page.getByText("Status: QUEUED").waitFor();
  await page.getByRole("button", { name: "Refresh processing status" }).click();
  await page.getByRole("heading", { name: "Review information from your document" }).waitFor();
  await page.getByLabel("tuition proposed amount").fill("42000.00");
  await page
    .getByLabel("Resolve conflict: profile.school")
    .fill("Use the current PSU offer");
  await page.getByLabel("review reason for tuition").fill("Reviewed corrected fee");
  await page.getByLabel("Document issuer").fill("PSU");
  await page
    .getByRole("button", { name: "Confirm selected information" })
    .click();
  await page.getByText("Your document review was saved.").waitFor();
  assert.equal(
    semester.draft.costs.find((c) => c.cost_id === "tuition").amount,
    "42000.00",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Complete expenses" })
    .click();
  await page.getByLabel("food amount").fill("3500.00");
  await page.getByRole("button", { name: "Save expense revisions" }).click();
  await page.getByText("Your expense changes were saved.").waitFor();
  assert.equal(
    semester.draft.costs.find((c) => c.cost_id === "food").amount,
    "3500.00",
  );
  await page.reload();
  await page.getByRole("heading", { name: "Check your school and dates" }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Complete expenses" })
    .click();
  assert.equal(await page.getByLabel("food amount").inputValue(), "3500.00");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Budget" })
    .click();
  await page.getByRole("button", { name: "Update budget results" }).click();
  await page
    .getByRole("alert")
    .getByText(/HTTP 503/)
    .waitFor();
  await page.getByRole("button", { name: "Update budget results" }).click();
  await page.getByText("Your budget results are ready.").waitFor();
  await page.getByRole("button", { name: "Update 90-day calendar" }).click();
  await page.getByText("Your payment calendar is ready.").waitFor();
  const calendar = page.getByRole("region", { name: "Payment calendar" });
  assert.match(await calendar.innerText(), /Aug 10, 2026/);
  assert.match(await calendar.innerText(), /Largest reserve gap[\s\S]*THB 7,000.00/);
  assert.match(await calendar.innerText(), /Balance after: THB 8,000.00/);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Funding" })
    .click();
  await page.getByText("Add a non-loan funding source").click();
  await page.getByLabel("Amount THB").fill("10000.00");
  await page.getByLabel("Available on").fill("2026-10-10");
  await page.getByRole("button", { name: "Save funding source" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Budget" }).click();
  assert.match(await calendar.innerText(), /Not received · estimated/);
  await page.getByRole("navigation").getByRole("button", { name: "Funding" }).click();
  await page.getByText("Explore funding sources and plan details").click();
  await page.getByText(/Compare \d+ simulated loan quotes?/).click();
  await page.getByRole("button", { name: "Get funding recommendation" }).click();
  await page.getByText("Your funding options are ready.").waitFor();
  const comparison = page.getByRole("region", { name: "Compare funding and loan options" });
  assert.match(await comparison.innerText(), /Not received/);
  assert.match(await comparison.innerText(), /B suggested allocation[\s\S]*THB 10,000.00/);
  assert.match(await comparison.innerText(), /Quote quote-older[\s\S]*THB 4,600.00/);
  await comparison.getByRole("article", { name: "Loan quote quote-older" }).getByText("All quote terms").click();
  assert.match(await comparison.getByRole("article", { name: "Loan quote quote-older" }).innerText(), /Total interest[\s\S]*Amount not supplied/);
  await comparison.getByRole("button", { name: "Check suggested funding plan" }).click();
  assert.match(await comparison.innerText(), /Saved validation: This plan has conditions that still need attention./);
  await page.getByRole("button", { name: "Refresh saved information" }).click();
  assert.match(await comparison.innerText(), /Saved validation: This plan has conditions that still need attention./);
  await comparison.getByText("Conditions to review").click();
  assert.match(await comparison.innerText(), /Family funds not received/);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Simulated application" })
    .click();
  await page.getByText("2. Create a loan quote").click();
  await page.getByLabel("Principal THB").fill("10000.00");
  await page.getByLabel("Annual rate as fraction").fill("0.12");
  await page.getByLabel("First due date").fill("2027-01-01");
  await page.getByRole("button", { name: "Create loan quote" }).click();
  await page.getByRole("button", { name: "Create application draft" }).click();
  await page.getByText(/Application app-1/).waitFor();
  await page
    .getByRole("button", { name: "Submit simulated application" })
    .click();
  await page
    .getByRole("alert")
    .getByText(/HTTP 503/)
    .waitFor();
  await page
    .getByRole("button", { name: "Submit simulated application" })
    .click();
  await page.locator(".application-status").getByText(/simulated application is under review/i).waitFor();
  await page.getByRole("navigation").getByRole("button", { name: "Funding" }).click();
  await page.getByText("Explore funding sources and plan details").click();
  await page.getByText(/Compare \d+ simulated loan quotes?/).click();
  assert.equal(await comparison.getByRole("article", { name: /Loan quote/ }).count(), 2);
  assert.match(await comparison.innerText(), /THB 10,662.00/);
  await comparison.getByRole("article", { name: "Loan quote quote-older" }).getByRole("button", { name: "Review this quote" }).click();
  assert.equal(await page.getByLabel("Select quote").inputValue(), "quote-older");
  await page.getByRole("navigation").getByRole("button", { name: "Complete expenses" }).click();
  if (!await page.getByLabel("food amount").isVisible()) await page.locator("#cost-food .cost-details > summary").click();
  await page.getByLabel("food amount").fill("");
  await page.getByRole("button", { name: "Save expense revisions" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Budget" }).click();
  assert.match(await calendar.innerText(), /Update needed/);
  assert.match(await calendar.innerText(), /Costs without a complete schedule/);
  assert.match(await calendar.innerText(), /Amount missing/);
  await page.getByRole("button", { name: "Update 90-day calendar" }).click();
  await calendar.getByText(/Backend forecast: incomplete/).waitFor();
  assert.match(await calendar.innerText(), /Backend forecast: incomplete/);
  assert.match(await calendar.innerText(), /scheduled item\(s\) lack enough information/);
  await page.getByRole("navigation").getByRole("button", { name: "Funding" }).click();
  await page.getByText("Explore funding sources and plan details").click();
  await page.getByText(/Compare \d+ simulated loan quotes?/).click();
  assert.match(await comparison.innerText(), /Recommendation needs updating/);
  await page.screenshot({
    path: screenshot('connected-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: screenshot('connected-mobile.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(importReads, 1);
  assert.ok(
    requests.some(
      (x) =>
        x.path === "readiness/budgets/" && x.body?.state_version < version,
    ),
  );
  assert.ok(requests.some((x) => x.path === "readiness/forecasts/" && x.body?.horizon === 90));
  console.log(
    "PASS: connected contract flow, payment calendar with B forecast, missing cost, funding date, stale results, upload/review/conflict, persistence, retries, mobile overflow, no runtime errors.",
  );
} finally {
  await browser.close();
}
