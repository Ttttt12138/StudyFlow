import { defineConfig } from '@playwright/test';
import { executablePath, outputDir } from './tests/support.mjs';

const baseURL = process.env.TEST_URL || 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `${outputDir}/test-results`,
  // Each spec is a long, stateful journey; integration specs also share one database.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { outputFolder: `${outputDir}/report`, open: 'never' }]],
  use: {
    baseURL,
    locale: 'en-US',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mocked', testDir: './tests/e2e/mocked' },
    // Needs Django, PostgreSQL and `manage.py readiness_worker --mode mock` (frontend/README.md).
    { name: 'integration', testDir: './tests/e2e/integration', timeout: 300_000 },
  ],
  // Starts Vite unless TEST_URL points at a server that is already running.
  webServer: process.env.TEST_URL ? undefined : {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
