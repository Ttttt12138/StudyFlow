import { test } from '@playwright/test';
import assert from "node:assert/strict";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
test.use({ viewport: { width: 1360, height: 900 } });

test("guided demo walks nine stops, side trips switch role, public pages hide student navigation, assistant drawer opens", async ({ page }) => {
  const errors = [];
  let apiCalls = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/v2/**", route => { apiCalls++; return route.abort(); });

  // Signed out, the home page offers sign-in, a recorded conversation and the guided demo.
  await page.goto(`${base}/`);
  await page.getByRole("link", { name: "Start the guided demo" }).click();
  const bar = page.getByRole("region", { name: "Guided demo" });
  // Stops follow the journey: consultation and funding tools, then the life stage with its money tools.
  // Tool stops open beside the conversation, which stays at the stop's stage.
  const stops = [["Study planner", "plan"], ["Family support", "plan"], ["Loans", "plan"], ["Study planner", "prepare"],
    ["Study planner", "school"], ["Wallet & transfers", "school"], ["Payments", "school"], ["Finance assistant", "school"],
    ["Permissions & activity", "school"]];
  for (const [index, [heading, stage]] of stops.entries()) {
    await bar.getByText(`Step ${index + 1} of 9`).waitFor();
    const tool = heading !== "Study planner";
    await page.getByRole("heading", { level: tool ? 2 : 1, name: heading, exact: true }).first().waitFor();
    assert.equal(await page.locator(".workspace-dock").isVisible(), tool);
    assert.equal(new URL(page.url()).searchParams.get("stage") ?? "plan", stage);
    if (index === 3) {
      assert.equal(await page.getByRole("group", { name: "Preview stage" }).getByRole("button", { name: "Before enrollment", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByText("Departure preparation", { exact: true }).first().waitFor();
    }
    if (index === 4) {
      assert.equal(await page.getByRole("button", { name: "In school", exact: true }).getAttribute("aria-pressed"), "true");
      await bar.getByRole("button", { name: /Open monthly spending/ }).click();
      await page.locator("#workspace-tool-title").getByText("Monthly spending").waitFor();
    }
    if (index < 8) await bar.getByRole("button", { name: "Next" }).click();
  }

  // The last stop's side trip is the anonymous verification page: no modules, no role switch, no assistant.
  await bar.getByRole("button", { name: /Open the verification page/ }).click();
  await page.getByRole("heading", { level: 1, name: "Verify an on-time statement" }).waitFor();
  assert.equal(await page.getByRole("group", { name: "Modules" }).count(), 0);
  assert.equal(await page.getByRole("group", { name: "View as" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "AI assistant", exact: true }).count(), 0);
  await bar.getByRole("button", { name: "Finish" }).click();
  assert.equal(await bar.count(), 0);

  // Operations is a separate role with its own address and no student module directory.
  await page.goto(`${base}/?wallet=preview`);
  await page.getByRole("group", { name: "View as" }).getByRole("button", { name: "Operations" }).click();
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/ops");
  assert.equal(await page.getByRole("group", { name: "Modules" }).count(), 0);
  await page.getByRole("group", { name: "View as" }).getByRole("button", { name: "Student" }).click();
  await page.getByRole("heading", { level: 1, name: "Study planner" }).waitFor();

  // The finance assistant opens as a drawer over a money page, in the same preview mode.
  await page.goto(`${base}/?wallet=preview`);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.locator("#workspace-tools").getByRole("button", { name: "Finance assistant", exact: true }).click();
  const drawer = page.locator(".workspace-dock");
  await drawer.getByText("Demo preview · read-only").first().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await drawer.isVisible(), false);

  // The original client-side demo stays reachable outside the main navigation.
  await page.goto(`${base}/?legacy=1`);
  await page.getByRole("heading", { name: "Start with the facts." }).waitFor();

  assert.equal(apiCalls, 0);
  assert.deepEqual(errors, []);
});
