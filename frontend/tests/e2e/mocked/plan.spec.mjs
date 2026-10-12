import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
// These cases exercise returning users; first-use introduction has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('studyflow.journey.v1:parent', '2'));
});
// The same recordings the preview uses (backend/auto_test/fixture_plan_preview.py).
const recorded = name => JSON.parse(readFileSync(new URL(`../../../src/plan/preview-data/${name}.json`, import.meta.url), "utf-8"));

test.describe("Planner preview", () => {
  test("shows a recorded parent conversation and the in-school stage without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(`${base}/?plan=preview`);
    await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor();
    const chat = page.locator("#plan-chat");
    await chat.getByText("I'm a parent", { exact: true }).first().waitFor();
    await chat.getByRole("heading", { name: "Schools in the catalog" }).waitFor();
    await chat.locator(".workspace-card-summary").filter({ hasText: "Schools in the catalog" }).getByRole("button", { name: "View details" }).click();
    assert.equal(await page.locator(".tool-content:not([hidden]) .plan-school").count() >= 10, true);
    await page.getByRole("button", { name: "Close tool" }).click();
    await chat.getByText("Cost for 4 year(s)", { exact: true }).first().waitFor();
    await chat.getByRole("heading", { name: "Simulated loan" }).waitFor();
    await chat.getByRole("heading", { name: "Confirm the study plan" }).waitFor();
    assert.equal(await chat.getByRole("button", { name: "Confirm", exact: true }).count(), 0, "preview never offers a decision");
    assert.ok(await chat.getByText("Sample data", { exact: true }).count() > 0, "school figures are labelled as sample data");
    await page.getByRole("button", { name: "My plan", exact: true }).click();
    await page.locator("#plan-summary").getByText("Funding gap").waitFor();
    await page.getByRole("button", { name: "Close tool" }).click();
    await page.screenshot({ path: screenshot("plan-preview-desktop-en.png"), fullPage: true });

    await chat.getByRole("button", { name: "Which schools are there?" }).click();
    await page.getByText("The preview is read-only. Sign in to talk to the assistant.").waitFor();

    await page.getByRole("button", { name: "In school", exact: true }).click();
    await page.getByRole("button", { name: "Bills & spending", exact: true }).click();
    await page.locator("#plan-school").getByRole("heading", { name: "Upcoming bills" }).waitFor();
    await chat.getByRole("heading", { name: "Confirm enrollment" }).waitFor();
    await chat.getByText("I spent 120 THB on lunch today", { exact: true }).first().waitFor();

    await page.getByRole("button", { name: "Close tool" }).click();
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { level: 1, name: "留学规划助手" }).waitFor();
    await chat.getByText("今天午饭花了120泰铢", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "English" }).click();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot("plan-preview-mobile-en.png"), fullPage: true });
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
  });
});

test.describe("Planner with mocked Django", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("sends messages, renders the returned cards and confirms the plan proposal", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const script = recorded("plan.en").conversation;
    const expires = new Date(Date.now() + 600000).toISOString();
    for (const turn of script.turns) {
      for (const pending of turn.pending_actions) pending.expires_at = expires;
      for (const card of turn.cards) if (card.type === "confirmation") card.expires_at = expires;
    }
    const [greeting, ...turns] = script.turns;
    const conversation = { ...script, plan: null, profile: { role: null, home_currency: "CNY" }, turns: [greeting] };
    const calls = [];
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/auth/session/", route => json(route, 200, { authenticated: true, username: "parent", csrf_token: "test-csrf" }));
    await page.route("**/api/v2/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v2/", "");
      calls.push(`${request.method()} ${path}`);
      if (request.method() === "POST") assert.ok(request.headers()["idempotency-key"], `${path} needs an Idempotency-Key`);
      if (path === "agent/conversations/" && request.method() === "GET") return json(route, 200, { data: [] });
      if (path === "agent/conversations/") return json(route, 201, { data: conversation });
      if (path.endsWith("/messages/")) {
        const text = request.postDataJSON().text;
        const next = turns.shift();
        assert.equal(text, next.goal);
        conversation.turns.push(next);
        conversation.profile.role = "parent";
        const plan = next.cards.find(card => card.plan)?.plan;
        if (plan) conversation.plan = plan;
        return json(route, 201, { data: next });
      }
      if (path.startsWith("agent/conversations/")) return json(route, 200, { data: conversation });
      if (path.startsWith("agent/pending-actions/") && path.endsWith("/confirm/")) {
        const pending = conversation.turns.flatMap(turn => turn.pending_actions).find(item => path.includes(item.id));
        pending.status = "CONFIRMED";
        conversation.plan = { ...conversation.plan, status: "CONFIRMED" };
        return json(route, 201, { data: pending });
      }
      if (path === "planning/in-school/") return json(route, 200, { data: { enrolled: false } });
      if (path === "planning/family-links/") return json(route, 200, { data: [] });
      return json(route, 404, { detail: "not mocked" });
    });

    await page.goto(`${base}/`);
    const chat = page.locator("#plan-chat");
    await chat.getByText("are you a parent, or the student?", { exact: false }).waitFor();
    await chat.getByRole("button", { name: "I'm a parent" }).click();
    await chat.getByRole("heading", { name: "Schools in the catalog" }).waitFor();
    // The parent view now suggests money questions; the rest of the script is typed.
    for (const turn of turns.slice(0, turns.length)) {
      await chat.getByLabel("Message the assistant").fill(turn.goal);
      await chat.getByLabel("Message the assistant").press("Enter");
      await chat.getByText(turn.final_answer.slice(0, 40), { exact: false }).first().waitFor();
    }
    await page.getByRole("button", { name: "My plan", exact: true }).click();
    await page.locator("#plan-summary").getByText("Draft").waitFor();
    await chat.locator(".plan-card-confirm").getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByText("Done. The plan is updated.").waitFor();
    await page.locator("#plan-summary").getByText("Confirmed").waitFor();
    assert.ok(calls.some(call => /^POST agent\/pending-actions\/.+\/confirm\/$/.test(call)));
    assert.deepEqual(errors, []);
  });
});
