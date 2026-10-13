import { test } from '@playwright/test';
import assert from "node:assert/strict";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
test.use({ viewport: { width: 1360, height: 900 } });

const settings = async page => {
  const menu = page.locator("#side-settings");
  if (!await menu.isVisible()) await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Settings", exact: true }).click();
  return menu;
};

test("guided demo walks nine stops, side trips switch role, public pages hide student navigation, preview tools open beside the chat", async ({ page }) => {
  const errors = [];
  let apiCalls = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/v2/**", route => { apiCalls++; return route.abort(); });

  // Signed out, the home page offers sign-in, a recorded conversation and the guided demo.
  await page.goto(`${base}/`);
  await page.getByRole("link", { name: "Start the guided demo" }).click();
  const bar = page.getByRole("region", { name: "Guided demo" });
  // Stops follow the product: price lookup, comparison and funding first, then the confirmed plan's to-dos,
  // then the enrolled stage. Tool stops open beside the conversation, which stays at the stop's stage.
  // Stops 6 and 7 both land in the single wallet & payments tool (the second on its Pay bills tab).
  // Stop 8 (index 7) is the in-school conversation itself: money moves are asked for in the main chat.
  const stops = [[null, "plan"], ["School comparison", "plan"], ["My plan", "plan"], ["To-dos & payments", "prepare"],
    [null, "school"], ["Wallet & payments", "school"], ["Wallet & payments", "school"], [null, "school"], ["Credit record", "school"]];
  for (const [index, [tool, stage]] of stops.entries()) {
    await bar.getByText(`Step ${index + 1} of 9`).waitFor();
    await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor({ state: "attached" });
    if (tool) await page.locator("#workspace-tool-title").getByText(tool, { exact: true }).waitFor();
    else await page.locator(".workspace-dock").waitFor({ state: "hidden" });
    assert.equal(new URL(page.url()).searchParams.get("stage") ?? "plan", stage);
    if (index === 3) {
      const menu = await settings(page);
      assert.equal(await menu.getByRole("group", { name: "Preview stage" }).getByRole("button", { name: "Before enrollment", exact: true }).getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Escape");
      await page.locator(".workspace-stage").getByText("Preparing to leave").waitFor();
    }
    if (index === 4) {
      const menu = await settings(page);
      assert.equal(await menu.getByRole("button", { name: "In school", exact: true }).getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Escape");
      // Enrolled: the sidebar now offers this month's spending.
      await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "This month's spending", exact: true }).waitFor();
      await bar.getByRole("button", { name: /Open this month's spending/ }).click();
      await page.locator("#workspace-tool-title").getByText("This month's spending").waitFor();
    }
    if (index === 6) await page.getByRole("tablist", { name: "Wallet & payments" }).getByRole("tab", { name: "Pay bills" }).and(page.locator("[aria-selected=true]")).waitFor();
    if (index === 7) await page.locator(".workspace-stage").getByText("Enrolled").waitFor();
    if (index < 8) await bar.getByRole("button", { name: "Next" }).click();
  }

  // The last stop's side trip is the anonymous verification page: no tools, no role switch, no assistant.
  await bar.getByRole("button", { name: /Open the verification page/ }).click();
  await page.getByRole("heading", { level: 1, name: "Verify an on-time statement" }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Tools" }).count(), 0);
  assert.equal(await page.getByRole("group", { name: "View as" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "AI assistant", exact: true }).count(), 0);
  await bar.getByRole("button", { name: "Finish" }).click();
  assert.equal(await bar.count(), 0);

  // Operations is a separate role with its own address and no student tool sidebar.
  await page.goto(`${base}/?wallet=preview`);
  await (await settings(page)).getByRole("group", { name: "View as" }).getByRole("button", { name: "Operations" }).click();
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/ops");
  assert.equal(await page.getByRole("navigation", { name: "Tools" }).count(), 0);
  await page.getByRole("group", { name: "View as" }).getByRole("button", { name: "Student" }).click();
  await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor({ state: "attached" });

  // A tool opened from the sidebar sits beside the conversation in the same read-only preview; Escape closes it.
  await page.goto(`${base}/?wallet=preview`);
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Wallet & payments", exact: true }).click();
  const drawer = page.locator(".workspace-dock");
  await drawer.locator("#workspace-tool-title").getByText("Wallet & payments").waitFor();
  await drawer.locator(".workspace-preview").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await drawer.isVisible(), false);

  // The original client-side demo stays reachable outside the main navigation.
  await page.goto(`${base}/?legacy=1`);
  await page.getByRole("heading", { name: "Start with the facts." }).waitFor();

  assert.equal(apiCalls, 0);
  assert.deepEqual(errors, []);
});
