import { test } from '@playwright/test';
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

test.use({ viewport: { width: 1360, height: 900 } });

test('dashboard mock, attention/clear/empty/stale/error/signed-out states, journey link, mobile layout, zero Django requests.', async ({ page }) => {
  const errors = [];
  let apiCalls = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v2/**", route => { apiCalls++; return route.abort(); });
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:5173");
    await page.getByRole("button", { name: "Preview student dashboard" }).click();
    await page.getByRole("heading", { name: "More information needed" }).waitFor();
    assert.match(await page.getByRole("main").innerText(), /Demo data · read-only/);
    assert.match(await page.getByRole("main").innerText(), /Tuition payment/);
    assert.match(await page.getByRole("main").innerText(), /food needs an amount/i);
    assert.match(await page.getByRole("main").innerText(), /1 unread/);
    assert.match(await page.getByRole("main").innerText(), /Tuition source conflict/);

    const scenario = page.getByLabel("Preview a state");
    await scenario.selectOption("clear");
    await page.getByRole("heading", { name: "Plan is up to date" }).waitFor();
    assert.match(await page.getByRole("main").innerText(), /No notifications to show/);
    await scenario.selectOption("empty");
    await page.getByText("No upcoming obligation was returned").waitFor();
    assert.match(await page.getByRole("main").innerText(), /No dated obligations were returned/);
    await scenario.selectOption("stale");
    await page.getByText("This demo briefing or calendar uses an older backend version").waitFor();
    await page.getByRole("status").filter({ hasText: "Update needed" }).getByRole("button", { name: "Refresh preview" }).click();
    await page.getByRole("heading", { name: "More information needed" }).waitFor();
    await page.getByText("This demo briefing or calendar uses an older backend version").waitFor({ state: "hidden" });
    assert.equal(await page.getByText("This demo briefing or calendar uses an older backend version").count(), 0);
    await scenario.selectOption("error");
    await page.getByRole("heading", { name: "We could not load the dashboard" }).waitFor();
    await scenario.selectOption("signed_out");
    await page.getByRole("heading", { name: "Connect to see your plan" }).waitFor();
    await scenario.selectOption("attention");
    await page.getByRole("heading", { name: "More information needed" }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: screenshot('dashboard-mobile.png'), fullPage: true });
    await page.getByRole("button", { name: "View payment calendar" }).click();
    await page.getByRole("heading", { name: "Budget", exact: true }).waitFor();
    assert.match(await page.getByRole("main").innerText(), /Read-only tour · synthetic data/);
    assert.equal(apiCalls, 0);
    assert.deepEqual(errors, []);
});
