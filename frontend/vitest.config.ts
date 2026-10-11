import { defineConfig } from 'vitest/config';

// Unit tests sit next to the code; the browser suites in tests/e2e run under Playwright.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test-setup.ts'] },
});
