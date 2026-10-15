import { test } from '@playwright/test';
import assert from "node:assert/strict";
import { screenshot } from "../../support.mjs";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";

test("sign-in links open /auth, which signs in with a password and returns to the page", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let signedIn = false, posted = null, csrf = null;
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: signedIn, csrf_token: "csrf-test" } }));
  await page.route("**/api/auth/password/sign-in/", async route => {
    posted = route.request().postDataJSON();
    csrf = route.request().headers()["x-csrftoken"];
    signedIn = posted.password === "right-password";
    await route.fulfill(signedIn
      ? { json: { authenticated: true, username: posted.login, email: "", csrf_token: "csrf-test" } }
      : { status: 400, json: { detail: "INVALID_CREDENTIALS", code: "INVALID_CREDENTIALS", message: "The email or password is incorrect." } });
  });
  await page.route("**/api/v2/**", route => route.fulfill({ status: 401, json: { detail: "Authentication credentials were not provided." } }));

  // Old loan links open the new loan panel; the conversation owns the sign-in prompt.
  await page.goto(`${base}/?loans=1`);
  const link = page.getByRole("link", { name: "Sign in to StudyFlow", exact: true });
  const href = await link.getAttribute("href");
  assert.match(href, /^\/auth\?next=/);
  const returnTo = new URL(href, base).searchParams.get('next');
  await link.click();
  await page.waitForURL(/\/auth\?next=/);
  await page.getByRole("heading", { name: "Sign in to StudyFlow" }).waitFor();
  assert.equal(await page.getByLabel("Email or username").evaluate(input => input === document.activeElement), true);
  await page.screenshot({ path: screenshot("sign-in-page.png") });

  await page.getByLabel("Email or username").fill("student");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("alert").filter({ hasText: "did not match" }).waitFor();
  assert.equal(csrf, "csrf-test", "the CSRF token travels as a header");
  assert.deepEqual(posted, { login: "student", password: "wrong" });

  await page.getByLabel("Password", { exact: true }).fill("right-password");
  await Promise.all([page.waitForURL(returnTo), page.getByRole("button", { name: "Log in" }).click()]);
  assert.deepEqual(errors, []);
});

test("email code sign-up asks for a code, then creates the account", async ({ page }) => {
  const calls = [];
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: false, csrf_token: "csrf-test" } }));
  await page.route("**/api/auth/otp/**", async route => {
    const body = route.request().postDataJSON();
    calls.push([new URL(route.request().url()).pathname, body]);
    if (route.request().url().includes("/request/")) return route.fulfill({ json: { message: "sent", expires_in: 600 } });
    return route.fulfill(body.code === "123456"
      ? { json: { authenticated: true, username: "sf_x", email: body.email, csrf_token: "csrf-test" } }
      : { status: 400, json: { detail: "OTP_INVALID", code: "OTP_INVALID" } });
  });
  await page.route("**/api/v2/**", route => route.abort());

  await page.goto(`${base}/auth?next=${encodeURIComponent(`${base}//evil.example`)}`);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("New Student");
  await page.getByLabel("Email address").fill("new@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Correct-Horse-42");
  await page.getByLabel("Confirm password").fill("Correct-Horse-42");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Six-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await page.getByRole("alert").filter({ hasText: "invalid or has expired" }).waitFor();
  await page.getByLabel("Six-digit code").fill("123456");
  // A protocol-relative `next` must not leave the site.
  await Promise.all([page.waitForURL(`${base}/`), page.getByRole("button", { name: "Verify and create account" }).click()]);
  assert.deepEqual(calls[0], ["/api/auth/otp/request/", { email: "new@example.com", purpose: "sign_up" }]);
  assert.equal(calls.at(-1)[1].full_name, "New Student");
});
