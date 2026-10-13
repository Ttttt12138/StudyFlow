import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
// The same recordings the preview uses (backend/auto_test/fixture_plan_preview.py).
const recorded = name => JSON.parse(readFileSync(new URL(`../../../src/plan/preview-data/${name}.json`, import.meta.url), "utf-8"));
const tools = page => page.getByRole("navigation", { name: "Tools" });

test.describe("Planner preview", () => {
  test("shows the recorded price conversation and the in-school stage without calling Django", async ({ page }) => {
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(`${base}/?plan=preview`);
    await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor({ state: "attached" });
    const chat = page.locator("#plan-chat");
    await chat.getByText("What does 4 years at Chulalongkorn cost in total?", { exact: true }).first().waitFor();
    // Whole-course price card with the total in the chosen currency; its line items open beside the chat.
    const price = chat.getByRole("article", { name: "Chulalongkorn University · 4-year total" });
    await price.getByText("฿2,351,350", { exact: true }).waitFor();
    await price.getByRole("button", { name: "Line items" }).click();
    await page.locator(".workspace-dock").waitFor();
    await page.getByRole("button", { name: "Close tool" }).click();
    // The comparison marks the lowest total; the plan shows the gap, the simulated loan and the confirmation.
    const compare = chat.getByRole("article", { name: "2 schools, whole-course totals" });
    await compare.getByText("Lowest current estimate", { exact: true }).waitFor();
    await chat.getByText("Funding gap about 851,350 THB", { exact: false }).waitFor();
    await chat.getByRole("heading", { name: "Simulated loan · 48 months" }).waitFor();
    await chat.getByRole("heading", { name: "Confirm the study plan" }).waitFor();
    assert.equal(await chat.getByRole("button", { name: "Confirm", exact: true }).count(), 0, "preview never offers a decision");
    assert.ok(await chat.getByText("Sample data", { exact: true }).count() > 0, "school figures are labelled as sample data");
    // The plan card opens the funding panel with its 90-day forecast; the sidebar item carries a funding-gap dot.
    await chat.getByRole("button", { name: "View my plan" }).click();
    await page.locator(".workspace-dock").getByText("Largest shortfall including reserve").first().waitFor();
    await tools(page).getByRole("button", { name: /^My plan/ }).getByRole("img", { name: "Funding gap" }).waitFor();
    await page.getByRole("button", { name: "Close tool" }).click();
    await page.screenshot({ path: screenshot("plan-preview-desktop-en.png"), fullPage: true });

    await chat.getByRole("button", { name: "Which schools are there?" }).click();
    await page.getByText("The preview is read-only. Sign in to talk to the assistant.").waitFor();

    // The stage switch lives in the sidebar settings menu.
    await tools(page).getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#side-settings").getByRole("button", { name: "In school", exact: true }).click();
    await tools(page).getByRole("button", { name: "To-dos & payments", exact: true }).click();
    await page.locator(".life-panel").getByRole("heading", { name: "Upcoming reminders" }).waitFor();
    await chat.getByText("I spent 120 THB on lunch today", { exact: true }).first().waitFor();

    await page.getByRole("button", { name: "Close tool" }).click();
    await page.getByRole("button", { name: "中文" }).click();
    await page.getByRole("heading", { level: 1, name: "留学规划助手" }).waitFor({ state: "attached" });
    await chat.getByText("今天午饭花了120泰铢", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "English" }).click();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor({ state: "attached" });
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
    await page.route("**/api/auth/session/", route => json(route, 200, { authenticated: true, username: "student", csrf_token: "test-csrf" }));
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
    // No role question any more: before the first question the price hero holds the composer.
    await chat.getByRole("heading", { name: "Know what studying abroad costs before you go" }).waitFor();
    for (const turn of [...turns]) {
      await chat.getByLabel("Message the assistant").fill(turn.goal);
      await chat.getByLabel("Message the assistant").press("Enter");
      await chat.getByText(turn.final_answer.slice(0, 40), { exact: false }).first().waitFor();
    }
    await chat.getByRole("article", { name: /Chulalongkorn University · 4-year total/ }).waitFor();
    await chat.getByText("Chulalongkorn University · Draft", { exact: true }).waitFor();
    await chat.locator(".plan-card-confirm").getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("dialog", { name: "Review and confirm" }).getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByText("Done. The plan is updated.").waitFor();
    // A confirmed plan moves to preparing: the sidebar and the preparing guide both offer the to-dos.
    await page.locator(".workspace-stage").getByText("Preparing to leave").waitFor();
    await tools(page).getByRole("button", { name: "To-dos & payments", exact: true }).waitFor();
    await chat.locator("#plan-journey-guide").getByRole("button", { name: "To-dos & payments", exact: true }).click();
    await page.locator("#workspace-tool-title").getByText("To-dos & payments", { exact: true }).waitFor();
    assert.ok(calls.some(call => /^POST agent\/pending-actions\/.+\/confirm\/$/.test(call)));
    assert.deepEqual(errors, []);
  });
});
