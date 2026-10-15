import { chromium } from '@playwright/test';
import { harness } from './harness.mjs';
import { planningJourney } from './planning.mjs';
import { paymentJourney, repaymentJourney } from './payments.mjs';
import { moneyJourney } from './money.mjs';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const h = harness(browser);
let success = false, failure;
try {
  const student = await h.login('student');
  await planningJourney(h, student);
  await paymentJourney(h, student);
  await moneyJourney(h, student);
  await repaymentJourney(h, student);
  success = true;
} catch (error) { failure = error; console.error(error); process.exitCode = 1; }
finally { await h.close(success, failure); await browser.close(); }
