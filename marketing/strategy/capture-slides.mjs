import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'kova-carrusel-c1-5-senales.html');
const OUT_DIR   = join(__dirname, 'export');

const LABELS = ['portada','senal-01','senal-02','senal-03','senal-04','senal-05','cierre'];
const TOTAL  = 7;
const W = 1080, H = 1350;

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();

// Load the file — use file:// URL
await page.goto('file:///' + HTML_PATH.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

// Wait for Inter font to be ready
await page.evaluateHandle('document.fonts.ready');

for (let i = 0; i < TOTAL; i++) {
  const label = LABELS[i];
  process.stdout.write(`  ${String(i+1).padStart(2,'0')}/${TOTAL}  ${label} … `);

  // showOnly isolates the slide and removes all transforms
  await page.evaluate((idx) => window.showOnly(idx), i);
  await new Promise(r => setTimeout(r, 120));

  const el = await page.$('.frame.active .slide');
  const file = join(OUT_DIR, `kova-c1-${String(i+1).padStart(2,'0')}-${label}.png`);
  await el.screenshot({ path: file, type: 'png' });

  console.log(`✓  ${file}`);
}

await browser.close();
console.log(`\nDone — ${TOTAL} PNGs en: ${OUT_DIR}`);
