import { test } from '@playwright/test';
import assert from "node:assert/strict";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test("intro deep links open the read-only tour at a step, and every app page links back to /intro", async ({ page }) => {
  const errors = [];
  let apiCalls = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { apiCalls++; return route.abort(); });

  await page.goto(`${base}/?journey=preview&step=budget`);
  await page.getByRole("region", { name: "Read-only tour" }).waitFor();
  assert.match(await page.locator('[aria-current="step"]').innerText(), /Budget/);
  assert.equal(new URL(page.url()).search, "", "the deep link is consumed so a reload starts fresh");

  await page.goto(`${base}/?journey=preview&step=calendar`);
  await page.getByRole("region", { name: "Payment calendar" }).waitFor();
  assert.equal(await page.locator(".preview-calendar-details").evaluate(details => details.open), true);

  const intro = page.getByRole("region", { name: "Simulation notice" }).getByRole("link", { name: /About StudyFlow/ });
  assert.equal(await intro.getAttribute("href"), "/intro");
  await page.goto(`${base}/?wallet=preview`);
  await page.getByRole("region", { name: "Simulation notice" }).getByRole("link", { name: /About StudyFlow/ }).waitFor();

  assert.equal(apiCalls, 0);
  assert.deepEqual(errors, []);
});
