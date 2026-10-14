import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

// The finance sub-assistant is merged into the planner conversation: transfers and currency exchange are asked,
// reviewed and confirmed (password step-up, or an operator approval above the limit) in the main chat.
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const inMinutes = minutes => new Date(Date.now() + minutes * 60 * 1000).toISOString();

test.describe("money in the conversation, preview", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("old assistant links land in the conversation, with no sub-assistant and no Django calls", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v2/**", route => { apiCalls++; return route.abort(); });
    await page.goto(`${base}/?agent=preview`);
    await page.getByText("Transfers and currency exchange are now asked and confirmed right here in the conversation.").waitFor();
    assert.equal(await page.locator(".workspace-dock").isVisible(), false);
    const tools = page.getByRole("navigation", { name: "Tools" });
    await tools.getByRole("button", { name: "This month" }).waitFor();
    assert.equal(await tools.getByRole("button", { name: "Finance assistant" }).count(), 0);
    await page.locator(".plan-composer textarea").waitFor();
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("money in the conversation with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("confirms a transfer with step-up in the chat and routes an over-limit one to operator approval", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "test-csrf" } }));
    const calls = [];
    const approvals = [];
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const proposal = (n, amount) => {
      const session = `00000000-0000-4000-8000-0000000000a${n}`;
      const pending = { id: `00000000-0000-4000-8000-0000000000b${n}`, session, step: "s2", action: "remittance.submit", tool: "submit_remittance_order",
        arguments: {}, target_id: `11111111-0000-4000-8000-0000000000c${n}`, amount, currency: "CNY", status: "PENDING",
        expires_at: inMinutes(15), decided_at: null, result: {}, version: 1, created_at: inMinutes(0) };
      const card = { type: "confirmation", action: "remittance.submit", pending_action_id: pending.id, details: {}, amount, currency: "CNY", expires_at: pending.expires_at };
      return { id: session, kind: "user", goal: `Send ${Number(amount)} CNY to my THB wallet`, final_answer: "Prepared a transfer. Review and confirm it.",
        status: "COMPLETED", error_code: "", created_at: inMinutes(0), cards: [card], pending_actions: [pending] };
    };
    const conversation = {
      id: "00000000-0000-4000-8000-00000000c0a1", locale: "en", profile: { role: null, home_currency: "THB" },
      plan: { id: "p1", status: "ENROLLED", school_key: "chulalongkorn", years: 4, start_date: "2026-08-02", version: 3, available_funds: null,
        funds_currency: "THB", school: { name: { en: "Chulalongkorn University", zh: "朱拉隆功大学" }, currency: "THB" }, total: "2351350.00", currency: "THB" },
      turns: [proposal(1, "5000.00"), proposal(2, "15000.00")],
    };
    const pendings = () => conversation.turns.flatMap(turn => turn.pending_actions);
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
      if (path === "agent/conversations/" && method === "GET") return json(route, 200, { data: [{ id: conversation.id, updated_at: inMinutes(0), turn_count: 2 }] });
      if (path.startsWith("agent/conversations/")) return json(route, 200, { data: conversation });
      if (path === "planning/in-school/") return json(route, 200, { data: { enrolled: false } });
      if (path === "planning/family-links/") return json(route, 200, { data: [] });
      if (path === "planning/rates/") return json(route, 200, { data: { thb_per_unit: { THB: "1", CNY: "4.60", USD: "33.00" }, rate_date: "2026-10-13", source: "fixture" } });
      if (path === "planning/schools/") return json(route, 200, { data: { schools: [] } });
      if (path === "auth/step-up/") {
        if (body.password !== "right-password") return json(route, 403, { detail: "STEP_UP_FAILED", code: "STEP_UP_FAILED", message: "Step-up failed." });
        return json(route, 200, { token: `grant-${body.target_id}`, expires_in_seconds: 300, action: body.action, target_id: body.target_id, amount: body.amount, currency: body.currency });
      }
      const confirm = path.match(/^agent\/pending-actions\/([^/]+)\/confirm\/$/);
      if (confirm) {
        const pending = pendings().find(p => p.id === confirm[1]);
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

    await page.goto(`${base}/`);
    const cards = page.locator(".plan-card-confirm");
    await cards.first().waitFor();
    assert.equal(await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Finance assistant" }).count(), 0);
    const first = cards.nth(0), second = cards.nth(1);
    await first.getByRole("heading", { name: "Submit transfer" }).waitFor();
    await first.getByText("Waiting for you").waitFor();

    // A wrong password is refused inside the dialog and nothing is confirmed.
    await first.getByRole("button", { name: "Review and confirm" }).click();
    const dialog = page.getByRole("dialog", { name: "Review and confirm" });
    assert.equal(await dialog.locator(".price-big").innerText(), "¥5,000");
    await dialog.getByLabel("Password").fill("wrong");
    await dialog.getByRole("button", { name: "Authorize and confirm" }).click();
    await dialog.getByText("That password was not accepted.", { exact: false }).waitFor();
    assert.equal(calls.filter(c => c.path.endsWith("/confirm/")).length, 0);
    await dialog.getByLabel("Password").fill("right-password");
    await dialog.getByRole("button", { name: "Authorize and confirm" }).click();
    await page.getByText("Confirmed. Django executed the action", { exact: false }).waitFor();
    await first.getByText("Confirmed", { exact: true }).waitFor();
    const stepUp = calls.filter(c => c.path === "auth/step-up/").at(-1);
    assert.deepEqual({ ...stepUp.body, password: undefined }, { password: undefined, action: "remittance.submit",
      target_id: pendings()[0].target_id, amount: "5000.00", currency: "CNY" });
    assert.equal(await page.getByLabel("Password").count(), 0);

    // Over the limit: the confirm is refused with APPROVAL_REQUIRED and the student requests approval instead.
    await second.getByRole("button", { name: "Review and confirm" }).click();
    await dialog.getByLabel("Password").fill("right-password");
    await dialog.getByRole("button", { name: "Authorize and confirm" }).click();
    await dialog.getByText("Operator approval required").waitFor();
    await dialog.getByLabel("Reason for the request").fill("Spring tuition");
    await dialog.getByRole("button", { name: "Request operator approval" }).click();
    await page.getByText("Approval requested.", { exact: false }).waitFor();
    const approvalPost = calls.find(c => c.path === "approvals/" && c.method === "POST");
    assert.deepEqual(approvalPost.body, { action: "remittance.submit", target_id: pendings()[1].target_id,
      amount: "15000.00", currency: "CNY", reason: "Spring tuition" });
    assert.equal(pendings()[1].status, "PENDING");
    await page.screenshot({ path: screenshot("money-in-chat-desktop.png"), fullPage: true });

    // Passwords never reach the URL or browser storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    assert.doesNotMatch(stored, /right-password|wrong/);
    assert.deepEqual(errors, []);
  });
});
