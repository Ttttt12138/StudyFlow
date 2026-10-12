import { test } from '@playwright/test';
import assert from "node:assert/strict";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test("intro deep links open the planner preview at a stage, old journey links still land there, and app pages link back to /intro", async ({ page }) => {
  const errors = [];
  let apiCalls = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { apiCalls++; return route.abort(); });

  await page.goto(`${base}/?plan=preview`);
  await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Choosing a school" }).getAttribute("aria-pressed"), "true");

  await page.goto(`${base}/?plan=preview&stage=school`);
  assert.equal(await page.getByRole("button", { name: "In school", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Bills & spending", exact: true }).click();
  await page.getByRole("tab", { name: "This month" }).click();
  await page.locator("#plan-school").getByRole("heading", { name: /^Spending in / }).waitFor();

  // Links shared before the planner replaced the five-step journey.
  await page.goto(`${base}/?journey=preview&step=budget`);
  await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor();

  const intro = page.getByRole("region", { name: "Simulation notice" }).getByRole("link", { name: /About StudyFlow/ });
  assert.equal(await intro.getAttribute("href"), "/intro");
  await page.goto(`${base}/?wallet=preview`);
  await page.getByRole("region", { name: "Simulation notice" }).getByRole("link", { name: /About StudyFlow/ }).waitFor();

  assert.equal(apiCalls, 0);
  assert.deepEqual(errors, []);
});
