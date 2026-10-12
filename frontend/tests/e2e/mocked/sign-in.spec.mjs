import { test } from '@playwright/test';
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test("sign-in links open a floating window that posts to Django's login view", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let signedIn = false, posted = null;
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: signedIn, csrf_token: "csrf-test" } }));
  await page.route("**/api/auth/login/**", async route => {
    posted = new URLSearchParams(route.request().postData() ?? "");
    signedIn = posted.get("password") === "right-password";
    await route.fulfill({ status: 200, contentType: "text/html", body: "<form></form>" });
  });
  await page.route("**/api/v2/**", route => route.abort());

  await page.goto(`${base}/?trust=1`);
  const link = page.locator('.workspace-dock').getByRole("link", { name: "Sign in to StudyFlow" });
  await link.click();
  const dialog = page.getByRole("dialog", { name: "Sign in to StudyFlow" });
  await dialog.waitFor();
  assert.equal(page.url(), `${base}/?trust=1`, "the page stays put");
  assert.equal(await page.getByLabel("Username").evaluate(input => input === document.activeElement), true);
  await page.waitForTimeout(400); // let the open animation finish
  await page.screenshot({ path: screenshot("sign-in-dialog.png") });

  await page.getByLabel("Username").fill("student");
  await page.getByLabel("Password").fill("wrong");
  await dialog.getByRole("button", { name: "Log in" }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(posted.get("csrfmiddlewaretoken"), "csrf-test");
  assert.match(posted.get("next"), /trust=1$/);

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await link.click();
  await page.getByLabel("Password").fill("right-password");
  await page.getByLabel("Username").fill("student");
  assert.match(await dialog.getByRole("link", { name: "Use the full sign-in page" }).getAttribute("href"), /^\/api\/auth\/login\//);
  // A good login reloads into the page the link was for.
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Log in" }).click()]);
  assert.match(page.url(), /\?trust=1$/);
  assert.deepEqual(errors, []);
});
