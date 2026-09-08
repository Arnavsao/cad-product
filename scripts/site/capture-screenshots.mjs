/**
 * Regenerates the editor screenshots the public site shows (`public/site/*.webp`).
 *
 * The pictures must be real, so this drives the actual editor in headless Chromium:
 * it opens `/editor`, drops the repository's sample DXF onto the canvas, zooms in,
 * opens the Layers / Blocks / AI panels, the first layout tab and the Plot dialog,
 * and encodes each capture to WebP in-page (no image tooling needed).
 *
 * Prerequisites (none are project dependencies on purpose — this runs rarely):
 *   1. A dev server in EMBEDDED mode so `/editor` needs no sign-in: temporarily blank
 *      `supabaseUrl` and `supabaseAnonKey` in src/environments/environment.ts, then
 *      `npx ng serve --port 4300`. Restore the file afterwards.
 *   2. `npm i --no-save playwright-core` and a Chromium binary; set CHROME to its path
 *      (a Playwright cache install under ~/Library/Caches/ms-playwright works).
 *
 *   CHROME=/path/to/Chromium node scripts/site/capture-screenshots.mjs [http://localhost:4300]
 */
import { chromium } from 'playwright-core';
import { writeFileSync, statSync } from 'node:fs';

const OUT = new URL('../../public/site/', import.meta.url).pathname;
const exe = process.env.CHROME;
if (!exe) throw new Error('Set CHROME to a Chromium executable');
const BASE = process.argv[2] ?? 'http://localhost:4300';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
const conv = await browser.newPage();

async function save(name, quality = 0.84) {
  const png = await page.screenshot({ type: 'png' });
  const dataUrl = await conv.evaluate(async ([b64, q]) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', q);
  }, [png.toString('base64'), quality]);
  const out = OUT + name + '.webp';
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(name, Math.round(statSync(out).size / 1024) + ' KB');
}

await page.goto(BASE + '/editor', { waitUntil: 'networkidle' });
await page.waitForSelector('.cad-canvas-container', { timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  const res = await fetch('/RTM-S%26C-GAD-BR-NO.384-DHD-IND(1x9.15m-PSC%20Slab).dxf');
  const text = await res.text();
  const file = new File([text], 'RTM-S&C-GAD-BR-NO.384-DHD-IND.dxf', { type: 'application/dxf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.querySelector('.cad-canvas-container');
  for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForFunction(() => !document.querySelector('ui-logo-loader'), null, { timeout: 180000 });
await page.waitForTimeout(2500);

// Zoom into the lower sheet so the drawing fills the viewport.
async function zoomAt(x, y, steps, dy) {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(90); }
  await page.waitForTimeout(600);
}
await zoomAt(735, 675, 6, -120);
await page.mouse.move(1200, 500);
await page.waitForTimeout(800);
await save('editor-model');

// A closer view of a detail for the product page.
await zoomAt(700, 640, 4, -120);
await page.waitForTimeout(800);
await save('editor-detail');
// Back out.
await zoomAt(700, 640, 4, 120);

// Layers panel.
await page.click('button:has-text("Layers")');
await page.waitForTimeout(900);
await save('editor-layers');

// Blocks palette.
await page.click('button:has-text("Blocks")');
await page.waitForTimeout(1200);
await save('editor-blocks');

// AI agent panel.
await page.click('button:has-text("AI Agent")');
await page.waitForTimeout(1200);
await save('editor-ai');

// Close the drawer (click the active sidebar button again) then the layout tab.
await page.click('button:has-text("AI Agent")');
await page.waitForTimeout(500);
await page.click('.ws-tab:not(.model-tab)');
await page.waitForTimeout(2500);
await save('editor-layout');

// Back to model, then the plot dialog.
await page.click('.ws-tab.model-tab');
await page.waitForTimeout(1200);
await page.click('button[title^="Plot"], button[data-tooltip^="Plot"], button[aria-label^="Plot"]');
await page.waitForTimeout(1800);
await save('editor-plot');

await browser.close();
