import { test } from '@playwright/test';
import assert from "node:assert/strict";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

const stageButton = async (page, name) => {
  const menu = page.locator("#side-settings");
  if (!await menu.isVisible()) await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Settings", exact: true }).click();
  return menu.getByRole("group", { name: "Preview stage" }).getByRole("button", { name, exact: true });
};

test("intro deep links open the planner preview at a stage, old journey links still land there, and app pages link back to /intro", async ({ page }) => {
  const errors = [];
  let apiCalls = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { apiCalls++; return route.abort(); });

  await page.goto(`${base}/?plan=preview`);
  await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor({ state: "attached" });
  assert.equal(await (await stageButton(page, "Choosing a school")).getAttribute("aria-pressed"), "true");

  // The /intro money links carry stage=prepare, where the life tools exist.
  await page.goto(`${base}/?plan=preview&stage=prepare`);
  assert.equal(await (await stageButton(page, "Application submitted")).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "To-dos and bills", exact: true }).click();
  await page.locator(".life-panel .life-list").first().waitFor();

  // The funding link from /intro opens the funding panel in the consultation stage.
  await page.goto(`${base}/?plan=preview&tool=funding`);
  await page.locator("#workspace-tool-title").getByText("My plan", { exact: true }).waitFor();
  await page.locator(".workspace-dock").getByText("Compare simulated loans · THB").waitFor();

  // Links shared before the planner replaced the five-step journey.
  await page.goto(`${base}/?journey=preview&step=budget`);
  await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor({ state: "attached" });

  const intro = page.getByRole("region", { name: "Simulation notice" }).getByRole("link", { name: /About StudyFlow/ });
  assert.equal(await intro.getAttribute("href"), "/intro");
  await page.goto(`${base}/?wallet=preview`);
  await page.getByRole("region", { name: "Simulation notice" }).getByRole("link", { name: /About StudyFlow/ }).waitFor();

  assert.equal(apiCalls, 0);
  assert.deepEqual(errors, []);
});
