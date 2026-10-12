// Captures the app's read-only preview screens (English and Chinese) that the /intro feature
// panels show, into public/intro-assets/screens/<feature>-<lang>.jpg.
// Needs the dev server: npm run dev, then node scripts/capture-intro-screens.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const out = new URL('../public/intro-assets/screens/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US' });
await context.addInitScript(() => localStorage.setItem('studyflow.lang', 'en'));
await context.route('**/api/**', route => route.abort());
const page = await context.newPage();

/** Scrolls a section near the top of the viewport (or the page top) and saves both languages. */
async function shoot(name, selector) {
  for (const lang of ['en', 'zh']) {
    await page.getByRole('button', { name: lang === 'en' ? 'English' : '中文' }).click();
    await page.waitForTimeout(250);
    await page.evaluate(sel => {
      const el = sel && document.querySelector(sel);
      if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -72); } else window.scrollTo(0, 0);
    }, selector);
    await page.waitForTimeout(250);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-${lang}.jpg`, out)), type: 'jpeg', quality: 80 });
  }
  // Later steps find their controls by English names.
  await page.getByRole('button', { name: 'English' }).click();
}

await page.goto(`${base}/?wallet=preview`);
await page.getByText('THB 52,500.00').first().waitFor();
await shoot('wallet', null);
await shoot('remit', '#wallet-quote');

await page.goto(`${base}/?trust=preview`);
await page.getByText('×1.2').first().waitFor();
await shoot('tiers', '#trust-tiers');
await shoot('credit', '#trust-credit');

await page.goto(`${base}/?agent=preview`);
await page.getByRole('article', { name: 'Submit transfer' }).waitFor();
await shoot('agent', '#agent-result');

// Budget and calendar live in the five-step journey's read-only tour.
await page.goto(base);
await page.getByRole('button', { name: 'Explore the five steps' }).click();
await page.getByRole('button', { name: /Explore expenses in this demo/ }).click();
await page.getByRole('navigation', { name: 'Study planning steps' }).getByRole('button', { name: 'Complete expenses' }).click();
await page.getByRole('button', { name: /Continue to Budget/ }).click();
await page.getByRole('heading', { name: 'Your budget needs more information' }).waitFor();
await page.getByRole('region', { name: 'What could you do about the missing food cost?' }).getByRole('button', { name: 'Find the missing food cost' }).click();
await page.locator('#cost-preview-food').getByRole('button', { name: /Try sample Food estimate/ }).click();
await page.locator('#cost-preview-food').getByRole('button', { name: 'Back to Budget' }).click();
await page.locator('.result-highlights').waitFor();
await shoot('budget', '.result-highlights');
await page.getByText('Explore the detailed payment calendar').click();
await page.getByRole('region', { name: 'Payment calendar' }).waitFor();
// The region is named through aria-labelledby, so mark it before the language changes.
await page.getByRole('region', { name: 'Payment calendar' }).evaluate(el => el.setAttribute('data-intro-shot', ''));
await shoot('calendar', '[data-intro-shot]');

await browser.close();
// A new version string makes browsers fetch the fresh images instead of cached ones.
writeFileSync(new URL('../src/intro/wall/screens-version.ts', import.meta.url), `// Written by scripts/capture-intro-screens.mjs; bumps the image URLs after each capture.
export const SCREENS_VERSION = "${Date.now().toString(36)}";
`);
console.log('intro screens captured');
