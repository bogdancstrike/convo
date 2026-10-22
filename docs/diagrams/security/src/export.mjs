// Exports each diagram's <svg> to SVG and PNG (2x, transparent), per the diagram-design export spec.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const names = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
for (const name of names) {
  await page.goto(`file:///work/${name}.html`);
  await page.evaluate(() => document.fonts.ready);
  const svg = page.locator('svg').first();
  writeFileSync(`/work/${name}.svg`, await svg.evaluate((el) => '<?xml version="1.0" encoding="UTF-8"?>\n' + el.outerHTML));
  await svg.screenshot({ path: `/work/${name}.png`, omitBackground: true });
  console.log('exported', name);
}
await browser.close();
