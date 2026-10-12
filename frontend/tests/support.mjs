// Shared settings for the browser suites. The repository keeps frontend/ (A),
// backend/ (B) and studyflow-ai/ (C) side by side.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const backend = `${root}backend`;
// Python that has the backend requirements installed; defaults to the repository's .venv.
export const python = process.env.PYTHON
  || `${root}.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`;
// Without CHROMIUM_PATH, Playwright uses the browser from `npx playwright install`.
export const executablePath = process.env.CHROMIUM_PATH || undefined;
export const outputDir = process.env.STUDYFLOW_TEST_OUTPUT || `${root}output/frontend`;
export const screenshot = name => {
  mkdirSync(outputDir, { recursive: true });
  return `${outputDir}/${name}`;
};
