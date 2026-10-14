import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Optional editorial timing for the real browser journey; never changes application data or answers.
export function demoRecording(output) {
  const enabled = process.env.SHORT_TEST_RECORD_VIDEO === '1';
  const marks = [];
  let started = 0;
  let page;
  return {
    active(target) { return target === page; },
    async focus(target, locator) {
      if (target === page) await locator.scrollIntoViewIfNeeded();
    },
    options(name) {
      if (!enabled || name !== 'short-desktop') return {};
      const dir = fileURLToPath(new URL('raw-video/', output));
      mkdirSync(dir, { recursive: true });
      return { recordVideo: { dir, size: { width: 1440, height: 900 } } };
    },
    start(target, name) {
      if (!enabled || name !== 'short-desktop') return;
      page = target;
      started = performance.now();
    },
    async mark(target, name, hold = 0) {
      if (target !== page) return;
      marks.push({ name, seconds: (performance.now() - started) / 1000 });
      writeFileSync(new URL('video-marks.json', output), JSON.stringify(marks, null, 2));
      if (hold) await page.waitForTimeout(hold * 1000);
    },
    async finish(target) {
      if (target !== page) return;
      const path = await page.video().path();
      writeFileSync(new URL('video-source.json', output), JSON.stringify({ path, viewport: '1440x900',
        timing: 'Seconds since recorded page creation; encoder frame start may differ slightly.' }, null, 2));
    },
  };
}
