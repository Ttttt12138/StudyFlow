import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { screenshot } from "../../support.mjs";
const recorded = name => JSON.parse(readFileSync(new URL(`../../../src/plan/preview-data/${name}.json`, import.meta.url), "utf8"));
const tools = page => page.getByRole("navigation", { name: "Tools" });

test("recorded price and application previews are read-only and share the live contract", async ({ page }) => {
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => { calls.push(route.request().url()); return route.abort(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?plan=preview");
  await expect(page.locator("#plan-chat")).toContainText("What does 4 years at Chulalongkorn cost in total?");
  await expect(page.getByRole("article", { name: "Chulalongkorn University · 4-year total" })).toContainText("฿2,351,350");
  await tools(page).getByRole("button", { name: "My plan", exact: true }).click();
  await expect(page.locator(".assessment-panel")).toContainText("48 months");
  await expect(page.locator(".assessment-panel").getByRole("button", { name: "Confirm plan and apply", exact: true })).toHaveCount(0);
  await page.goto("/?plan=preview&stage=prepare&tool=funding");
  await expect(page.locator(".assessment-panel").getByRole("img", { name: "Where the money goes", exact: true })).toBeVisible();
  const notice = page.getByRole("checkbox", { name: /Simulated admission notice/ });
  await expect(notice).toBeChecked();
  await expect(notice).toBeDisabled();
  await expect(tools(page).getByRole("button", { name: "Wallet & payments", exact: true })).toBeVisible();
  await page.screenshot({ path: screenshot("simplified-application-desktop.png") });
  // Approved but unsigned: reminders count only what the family pays; the loan's share is set aside.
  await page.goto("/?plan=preview&stage=prepare&tool=life");
  const life = page.locator(".tool-content:not([hidden]) .life-panel");
  await life.getByRole("button", { name: /^Later/ }).click();
  await expect(life).toContainText("Once signed, the loan pays THB 111,950.00; you pay THB 5,650.00");
  await expect(life).toContainText("The loan pays this to the school once it is approved and signed");
  await expect(life).not.toContainText(/family support/i);
  await life.locator(".life-item", { hasText: "The loan pays this to the school once it is approved and signed" }).first().locator(".life-item-main").click();
  const detail = page.locator(".tool-content:not([hidden]) .life-detail");
  const payActions = /^(Pay from wallet|Record as paid)$/;
  await expect(detail.getByRole("button", { name: payActions })).toHaveCount(0);
  // A bill the family pays itself still offers both.
  await page.getByRole("button", { name: "Back to the list", exact: true }).click();
  await life.locator(".life-item", { hasText: "Student health insurance" }).first().locator(".life-item-main").click();
  await expect(detail.getByRole("button", { name: payActions })).toHaveCount(2);
  expect(calls).toEqual([]); expect(errors).toEqual([]);
});

test("loan amount is required, estimate precedes submission, and application unlocks tools", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const draft = recorded("plan.en"), applied = recorded("prepare.en");
  const conversation = structuredClone(draft.conversation);
  let assessment = structuredClone(draft.assessment);
  assessment.quotes = []; assessment.inputs.loan.principal = null;
  const submissions = [], saves = [];
  const life = recorded("life.prepare.en");
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "mock" } }));
  await page.route("**/api/v2/**", route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace("/api/v2/", "");
    const ok = data => route.fulfill({ json: { data } });
    if (path === "planning/assessment/" && req.method() === "POST") {
      const body = req.postDataJSON(); saves.push(body);
      assessment = { ...assessment, inputs: body.inputs, version: assessment.version + 1, draft: body.draft,
        quotes: body.draft ? [] : structuredClone(draft.assessment.quotes) };
      return ok(assessment);
    }
    if (path === "planning/plan/confirm/") {
      submissions.push(req.postDataJSON()); conversation.plan = applied.conversation.plan;
      assessment = { ...applied.assessment, version: assessment.version, plan: conversation.plan };
      return ok(assessment);
    }
    if (path === "planning/loan-preview/") return ok({ ...draft.assessment.quotes[0].result,
      principal: req.postDataJSON().principal, product: "custom", months: 48, method: "amortized",
      annual_rate: "0.06", monthly_payment: "4697.01", schedule: [], currency: "THB" });
    if (path === "agent/conversations/") return ok([{ id: conversation.id }]);
    if (path.startsWith("agent/conversations/")) return ok(conversation);
    if (path === "planning/assessment/") return ok(assessment);
    if (path === "planning/history/") return ok({ prices: [], drafts: [], draft_limit: 3 });
    if (path === "planning/life/") return ok(life);
    return ok([]);
  });
  await page.goto("/?tool=funding");
  const dock = page.locator(".assessment-panel");
  await expect(dock.getByRole("img", { name: "Where the money goes", exact: true })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Estimate repayments", exact: true })).toBeDisabled();
  await expect(dock.getByText(/No loan,|Family covers it/)).toHaveCount(0);
  await dock.getByRole("spinbutton", { name: "Loan amount", exact: true }).fill("200000");
  await dock.getByRole("button", { name: "Estimate repayments", exact: true }).click();
  await dock.getByRole("button", { name: "Confirm plan and apply", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("simulated admission notice");
  expect(submissions).toEqual([]);
  await dialog.getByRole("button", { name: "Confirm plan and apply", exact: true }).click();
  await expect(tools(page).getByRole("button", { name: "Wallet & payments", exact: true })).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0].quote_id).toBe(draft.assessment.quotes[0].id);
  expect(saves.find(row => !row.draft).inputs.loan.principal).toBe("200000.00");
  expect(Object.keys(saves[0].inputs).sort()).toEqual(["borrower", "loan"]);
  await expect(dock.getByRole("heading", { name: "Complete signing", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dock.getByRole("button", { name: "Sign the loan", exact: true })).toBeDisabled();
  await expect(dock).toContainText("Complete the 2 remaining documents before signing.");
  await expect(dock.locator(".plan-visual")).toHaveCount(0);
  await page.reload();
  await expect(dock.getByRole("heading", { name: "Complete signing", exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Back to the list", exact: true }).click();
  const next = dock.getByRole("button", { name: "Next: complete signing", exact: true });
  await expect(next).toBeInViewport({ ratio: 1 });
  await expect(dock).toContainText("The loan has not been signed yet.");
  await expect(dock.getByRole("img", { name: "Where the money goes", exact: true })).toBeVisible();
  await next.click();
  await expect(dock.getByRole("heading", { name: "Complete signing", exact: true })).toBeInViewport({ ratio: 1 });
  expect(submissions).toHaveLength(1);
});

for (const width of [390, 1440]) test(`signing is the next step and documents still need confirmation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const applied = recorded("prepare.en"), assessment = applied.assessment;
  const posts = [];
  await page.route("**/api/auth/session/", route => route.fulfill({ json: { authenticated: true, username: "student", csrf_token: "mock" } }));
  await page.route("**/api/v2/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/v2/", "");
    const ok = data => route.fulfill({ json: { data } });
    if (path === "agent/conversations/") return ok([{ id: applied.conversation.id }]);
    if (path.startsWith("agent/conversations/")) return ok(applied.conversation);
    if (request.method() === "POST") {
      posts.push(path);
      if (path === "planning/loan/documents/") {
        const body = request.postDataJSON();
        const doc = assessment.loan_stage.documents.find(d => d.id === body.task_id);
        expect(body.expected_version).toBe(doc.version);
        doc.done = body.done; doc.version++;
        return ok(assessment);
      }
      if (path === "planning/loan/sign/") {
        expect(request.postDataJSON()).toEqual({ application_id: assessment.lifecycle.applications[0].id,
          expected_version: assessment.lifecycle.applications[0].version });
        assessment.loan_stage.signed = true;
        assessment.lifecycle.applications[0].status = "DISBURSED";
        return ok(assessment);
      }
      return route.fulfill({ status: 500, json: { detail: `Unexpected POST ${path}` } });
    }
    if (path === "planning/assessment/") return ok(assessment);
    if (path === "planning/history/") return ok({ prices: [], drafts: [], draft_limit: 3 });
    if (path === "planning/life/") return ok(recorded("life.prepare.en"));
    return ok([]);
  });
  await page.goto("/?tool=funding");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  const panel = page.locator(".assessment-panel");
  await expect(panel.getByRole("heading", { name: "完成签约", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(panel.getByRole("button", { name: "签约", exact: true })).toBeDisabled();
  await expect(panel).toContainText("请先补齐剩余 2 项材料，再完成签约。");
  expect(posts).toEqual([]);
  await page.locator(".workspace-dock").screenshot({ path: screenshot(`signing-documents-${width}-zh.png`), animations: "disabled" });
  for (const doc of assessment.loan_stage.documents.filter(d => !d.auto)) {
    await panel.getByRole("checkbox", { name: new RegExp(doc.title.zh) }).click();
    await expect(panel.getByRole("checkbox", { name: new RegExp(doc.title.zh) })).toBeEnabled();
    await expect.poll(() => posts.filter(p => p === "planning/loan/documents/").length).toBeGreaterThan(0);
    await expect(panel.getByRole("checkbox", { name: new RegExp(doc.title.zh) })).toBeChecked();
  }
  await expect(panel.getByRole("button", { name: "签约", exact: true })).toBeEnabled();
  await expect(panel).toContainText("材料已齐备，请核对贷款信息并确认签约。");
  await page.locator(".workspace-dock").screenshot({ path: screenshot(`signing-ready-${width}-zh.png`), animations: "disabled" });
  expect(posts).not.toContain("planning/loan/sign/");
  await panel.getByRole("button", { name: "签约", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认签约", exact: true });
  await expect(dialog).toContainText("贷款按学期直接付给学校");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  expect(posts).not.toContain("planning/loan/sign/");
  await panel.getByRole("button", { name: "签约", exact: true }).click();
  await dialog.getByRole("button", { name: "签约", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "已签约", exact: true })).toBeInViewport({ ratio: 1 });
  expect(posts.filter(p => p === "planning/loan/sign/")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".workspace-dock").screenshot({ path: screenshot(`signing-complete-${width}-zh.png`), animations: "disabled" });
});

test("cost composition stays visible in both languages on desktop and phone", async ({ page }) => {
  await page.route("**/api/**", route => route.abort());
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?plan=preview&tool=funding");
    for (const language of ["English", "中文"]) {
      await page.getByRole("button", { name: language, exact: true }).click();
      const visual = page.locator(".plan-visual");
      await expect(visual.getByRole("img", { name: language === "English" ? "Where the money goes" : "钱花在哪里", exact: true })).toBeVisible();
      await expect(visual).toContainText("฿2,351,350");
      await expect(visual).toContainText("฿675,250");
      await expect(visual.locator(".chart-legend li")).toHaveCount(3);
      await expect(visual.locator(".chart-legend")).toContainText("43.8%");
      await expect(visual.locator(".chart-legend")).toContainText("49.6%");
      await expect(visual.locator(".chart-legend")).toContainText("6.6%");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".workspace-dock").screenshot({ path: screenshot(`cost-composition-${width}-${language === "English" ? "en" : "zh"}.png`) });
      await visual.screenshot({ path: screenshot(`cost-summary-${width}-${language === "English" ? "en" : "zh"}.png`) });
    }
  }
});
