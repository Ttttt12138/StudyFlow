import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Browser-rendered comparisons keep the approved source untouched.
const [sourcePath, capturePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !capturePath || !outputPath) throw new Error('Usage: source.png capture.png output-directory');
const source = readFileSync(sourcePath).toString('base64');
const capture = readFileSync(capturePath).toString('base64');
mkdirSync(outputPath, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 3172, height: 1032 }, deviceScaleFactor: 1 });
  const render = async (focused) => {
    const width = focused ? 386 : 1586;
    await page.setViewportSize({ width: width * 2, height: focused ? 900 : 1032 });
    await page.setContent(`<style>body{margin:0;background:#111;color:white;font:16px sans-serif;display:flex}section{width:${width}px;overflow:hidden}h2{height:40px;box-sizing:border-box;margin:0;padding:10px;font:16px sans-serif}div{overflow:hidden}img{display:block;width:1586px;${focused ? 'margin-left:-1200px;margin-top:-120px;' : ''}}</style>
      <section><h2>Approved design</h2><div><img src="data:image/png;base64,${source}"></div></section>
      <section><h2>Browser implementation</h2><div><img src="data:image/png;base64,${capture}"></div></section>`);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.screenshot({ path: resolve(outputPath, focused ? 'comparison-status.png' : 'comparison-full.png') });
  };
  await render(false);
  await render(true);
} finally { await browser.close(); }
