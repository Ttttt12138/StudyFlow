import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const inMinutes = minutes => new Date(Date.now() + minutes * 60 * 1000).toISOString();

test.describe("AI assistant preview", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows tiers, steps and a read-only proposal without calling Django, in both languages", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?agent=preview`);
    await page.getByRole("heading", { name: "Finance assistant" }).waitFor();
    await page.getByRole("region", { name: "Simulation notice" }).getByText("SIMULATED", { exact: true }).waitFor();
    await page.getByText("Demo preview · read-only").waitFor();
    const proposal = page.getByRole("article", { name: "Submit transfer" });
    await proposal.getByText("CNY 5,000.00").waitFor();
    await proposal.getByText("Not executed.", { exact: false }).waitFor();
    assert.equal(await proposal.getByRole("button", { name: "Confirm with password" }).isDisabled(), true);
    assert.equal(await proposal.getByRole("button", { name: "Reject" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Ask the assistant" }).isDisabled(), true);
    const steps = await page.locator(".agent-step").allInnerTexts();
    assert.equal(steps.length, 8);
    assert.match(steps[2], /T1[\s\S]*Price a route/);
    assert.match(steps[6], /T2[\s\S]*Propose submitting a transfer[\s\S]*Proposed/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("agent-preview-mobile-en.png"), fullPage: true });

    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { name: "资金子助手" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), "zh-CN");
    await page.getByRole("article", { name: "提交汇款" }).getByText("等待你处理").waitFor();
    await page.getByText("帮我把5000元人民币汇到泰铢，比较一下渠道", { exact: true }).first().waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "资金子助手" }).waitFor();  // the choice is remembered
    await page.screenshot({ path: screenshot("agent-preview-mobile-zh.png"), fullPage: true });
    await page.getByRole("button", { name: "English" }).click();
    await page.getByRole("heading", { name: "Finance assistant" }).waitFor();
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("AI assistant with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("asks, confirms a T2 proposal with step-up, and routes a T3 proposal to operator approval", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "test-csrf" } }));
    const calls = [];
    const sessions = [];
    const approvals = [];
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const makeSession = (goal, amount) => {
      const n = sessions.length + 1;
      const id = `00000000-0000-4000-8000-0000000000a${n}`;
      const pending = { id: `00000000-0000-4000-8000-0000000000b${n}`, session: id, step: "s2", action: "remittance.submit", tool: "submit_remittance_order",
        arguments: { order_id: "order-" + amount, recipient: "SELF", receive_currency: "THB", receive_amount: "22908.09" },
        target_id: `11111111-0000-4000-8000-0000000000c${n}`, amount, currency: "CNY", status: "PENDING",
        expires_at: inMinutes(15), decided_at: null, result: {}, version: 1, created_at: inMinutes(0) };
      return { id, goal, locale: "en", mode: "mock", status: "COMPLETED", final_answer: "Prepared an order. Confirm it to submit.",
        error_code: "", write_count: 2, created_at: inMinutes(0), updated_at: inMinutes(0), is_simulated: true,
        steps: [
          { id: "s1", number: 1, tool: "create_remittance_order", tier: "T1", arguments: {}, rationale: "Prepare the order", status: "OK", result: { id: "order" }, created_at: inMinutes(0) },
          { id: "s2", number: 2, tool: "submit_remittance_order", tier: "T2", arguments: {}, rationale: "Propose submission", status: "PROPOSED", result: {}, created_at: inMinutes(0) },
          { id: "s3", number: 3, tool: "", tier: "", arguments: {}, rationale: "", status: "FINAL", result: { answer: "done" }, created_at: inMinutes(0) },
        ],
        pending_actions: [pending] };
    };
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      const method = request.method();
      const body = method === "POST" ? request.postDataJSON() : null;
      const headers = request.headers();
      calls.push({ path, method, body, headers });
      if (method === "POST") {
        assert.equal(headers["x-csrftoken"], "test-csrf");
        assert.ok(headers["idempotency-key"]);
      }
      assert.equal(headers["accept-language"], "en");
      if (path === "agent/sessions/" && method === "GET") return json(route, 200, { count: sessions.length, next: null, previous: null, results: [...sessions].reverse() });
      if (path === "agent/sessions/" && method === "POST") {
        const session = makeSession(body.goal, body.goal.includes("15000") ? "15000.00" : "5000.00");
        sessions.push(session);
        return json(route, 201, { data: session });
      }
      const detail = path.match(/^agent\/sessions\/([^/]+)\/$/);
      if (detail) return json(route, 200, { data: sessions.find(s => s.id === detail[1]) });
      if (path === "approvals/" && method === "GET") return json(route, 200, { count: approvals.length, next: null, previous: null, results: approvals });
      if (path === "auth/step-up/") {
        if (body.password !== "right-password") return json(route, 403, { detail: "STEP_UP_FAILED", code: "STEP_UP_FAILED", message: "Step-up failed." });
        return json(route, 200, { token: `grant-${body.target_id}`, expires_in_seconds: 300, action: body.action, target_id: body.target_id, amount: body.amount, currency: body.currency });
      }
      const confirm = path.match(/^agent\/pending-actions\/([^/]+)\/confirm\/$/);
      if (confirm) {
        const pending = sessions.flatMap(s => s.pending_actions).find(p => p.id === confirm[1]);
        assert.equal(headers["x-step-up-token"], `grant-${pending.target_id}`);
        if (pending.amount === "15000.00") return json(route, 403, { detail: "APPROVAL_REQUIRED", code: "APPROVAL_REQUIRED", message: "Approval required.",
          policy: { action: "remittance.submit", tier: "T3", requires: ["step_up", "approval"] } });
        Object.assign(pending, { status: "CONFIRMED", decided_at: inMinutes(0), version: 2, result: { status: "SUBMITTED" } });
        return json(route, 201, { data: pending });
      }
      if (path === "approvals/" && method === "POST") {
        const approval = { id: "approval-1", ...body, status: "PENDING", expires_at: inMinutes(24 * 60), version: 1 };
        approvals.push(approval);
        return json(route, 201, { data: approval });
      }
      return json(route, 404, { detail: `Unexpected ${method} ${path}` });
    });

    await page.goto(`${base}/?agent=1`);
    await page.getByRole("heading", { name: "Finance assistant" }).waitFor();
    await page.getByText("No conversation selected yet.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Send 5000 CNY to my THB wallet and compare the routes" }).click();
    await page.getByRole("button", { name: "Ask the assistant" }).click();
    const first = page.getByRole("article", { name: "Submit transfer" });
    await first.getByText("Waiting for you").waitFor();
    const created = calls.find(c => c.path === "agent/sessions/" && c.method === "POST");
    assert.deepEqual(created.body, { goal: "Send 5000 CNY to my THB wallet and compare the routes", locale: "en" });

    // A wrong password is refused next to the form and nothing is confirmed.
    await first.getByRole("button", { name: "Confirm with password" }).click();
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Authorize and confirm" }).click();
    await page.getByRole("dialog").getByText("That password was not accepted.", { exact: false }).waitFor();
    assert.equal(calls.filter(c => c.path.endsWith("/confirm/")).length, 0);
    await page.getByLabel("Password").fill("right-password");
    await page.getByRole("button", { name: "Authorize and confirm" }).click();
    await page.getByText("Confirmed. Django executed the action", { exact: false }).waitFor();
    await first.getByText("Confirmed", { exact: true }).waitFor();
    const stepUp = calls.filter(c => c.path === "auth/step-up/").at(-1);
    assert.deepEqual({ ...stepUp.body, password: undefined }, { password: undefined, action: "remittance.submit",
      target_id: sessions[0].pending_actions[0].target_id, amount: "5000.00", currency: "CNY" });
    assert.equal(await page.getByLabel("Password").count(), 0);

    // Over the limit: the confirm is refused with APPROVAL_REQUIRED and the student requests approval.
    await page.getByLabel("Your request").fill("Send 15000 CNY to THB");
    await page.getByRole("button", { name: "Ask the assistant" }).click();
    await page.getByRole("heading", { name: "Waiting for your decision" }).waitFor();
    const second = page.getByRole("article", { name: "Submit transfer" });
    await second.getByText("CNY 15,000.00").waitFor();
    await second.getByRole("button", { name: "Confirm with password" }).click();
    await page.getByLabel("Password").fill("right-password");
    await page.getByRole("button", { name: "Authorize and confirm" }).click();
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("heading", { name: "Operator approval required" }).waitFor();
    await page.getByLabel("Reason for the request").fill("Spring tuition");
    await page.getByRole("button", { name: "Request operator approval" }).click();
    await page.getByText("Approval requested.", { exact: false }).waitFor();
    await second.getByText("Operator approval: Waiting for an operator").waitFor();
    assert.match(await second.locator(".tier-badge").first().innerText(), /T3/);
    const approvalPost = calls.find(c => c.path === "approvals/" && c.method === "POST");
    assert.deepEqual(approvalPost.body, { action: "remittance.submit", target_id: sessions[1].pending_actions[0].target_id,
      amount: "15000.00", currency: "CNY", reason: "Spring tuition" });
    assert.equal(sessions[1].pending_actions[0].status, "PENDING");
    await page.screenshot({ path: screenshot("agent-connected-desktop.png"), fullPage: true });

    // Recent conversations reopen an earlier session.
    await page.locator("#agent-history").getByRole("button", { name: "Send 5000 CNY to my THB wallet and compare the routes" }).click();
    await page.getByRole("heading", { name: "Proposals", exact: true }).waitFor();
    // Passwords never reach the URL or browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    assert.doesNotMatch(stored, /right-password|wrong/);
    assert.deepEqual(errors, []);
  });
});
