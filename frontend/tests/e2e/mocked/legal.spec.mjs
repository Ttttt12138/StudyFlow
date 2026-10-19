import { test } from '@playwright/test';
import assert from "node:assert/strict";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test("/terms and /privacy render in both languages and are linked from sign-up and the planner settings", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false, csrf_token: "csrf-test" } }));
  await page.route("**/api/v2/**", route => route.fulfill({ status: 401, json: { detail: "Authentication credentials were not provided." } }));

  await page.goto(`${base}/terms`);
  await page.getByRole("heading", { level: 1, name: "Terms of Use" }).waitFor();
  await page.getByRole("heading", { name: "2. A demonstration with simulated money" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Terms of Use" }).first().getAttribute("aria-current"), "page");

  await page.getByRole("link", { name: "Privacy Notice", exact: true }).click();
  await page.waitForURL(/\/privacy$/);
  await page.getByRole("heading", { level: 1, name: "Privacy Notice" }).waitFor();
  await page.getByRole("button", { name: "中文" }).click();
  await page.getByRole("heading", { level: 1, name: "隐私声明" }).waitFor();
  await page.getByRole("button", { name: "English" }).click();

  // Sign-up says what creating an account agrees to; every mode links both pages.
  await page.goto(`${base}/auth?mode=signup`);
  const agree = page.locator(".auth-agree");
  await agree.waitFor();
  assert.match(await agree.textContent(), /By creating an account, you agree to the Terms of Use and acknowledge the Privacy Notice\./);
  assert.equal(await agree.getByRole("link", { name: "Terms of Use" }).getAttribute("href"), "/terms");
  assert.equal(await agree.getByRole("link", { name: "Privacy Notice" }).getAttribute("href"), "/privacy");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal(await page.locator(".auth-agree").count(), 0);
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy Notice" }).waitFor();

  await page.goto(`${base}/?plan=preview`);
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(await page.locator("#side-settings").getByRole("link", { name: "Terms of Use" }).getAttribute("href"), "/terms");

  assert.deepEqual(errors, []);
});
