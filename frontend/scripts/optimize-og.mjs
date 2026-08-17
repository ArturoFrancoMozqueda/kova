// Optimize the hand-designed OG/social-share export into the asset the site
// serves. The master lives in output/ (a high-res Figma export); social
// scrapers — WhatsApp especially — won't render previews from very heavy
// images, so we downscale to the declared 1200×630 and keep the file small.
//
// Master:  output/Kova OG link-share-v3.png   (generated high-res source, tracked)
// Output:  frontend/public/og-image-v3.png    (1200×630, referenced by index.html)
//
// Re-run after re-exporting the design:  npm run optimize:og
import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile, rm, stat } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "..", "output", "Kova OG link-share-v3.png");
const OUT = resolve(__dirname, "..", "public", "og-image-v3.png");
const TMP_HTML = resolve(__dirname, "..", "..", "output", "_og_resize.html");

const WIDTH = 1200;
const HEIGHT = 630;

// A same-origin file:// page so the relative <img> can load (about:blank can't).
const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#0A0C12}
img{display:block;width:${WIDTH}px;height:${HEIGHT}px;object-fit:contain}</style>
<img src="${SRC.split(/[\\/]/).pop()}">`;

async function main() {
  await writeFile(TMP_HTML, html, "utf8");
  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(TMP_HTML).href, { waitUntil: "networkidle" });
    await page.locator("img").screenshot({ path: OUT });
    await browser.close();
  } finally {
    await rm(TMP_HTML, { force: true });
  }
  const { size } = await stat(OUT);
  console.log(`Wrote ${OUT} (${WIDTH}×${HEIGHT}, ${(size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
