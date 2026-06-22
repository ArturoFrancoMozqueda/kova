// Regenerate the Open Graph / social share image from the static template.
//
// Renders scripts/og-image.template.html (a self-contained 1200×630
// product-showcase design that embeds a REAL product screenshot from
// public/showcase/) with headless Chromium and writes the PNG that
// <meta property="og:image"> points to. The template lives under scripts/ (not
// the gitignored assets/) so a fresh clone can regenerate it. Run this whenever
// the landing positioning or the showcase shots change so the link preview
// never drifts from the live site again.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//   From /frontend:  npm run capture:og
//
// Output: frontend/public/og-image-v2.png  (1200×630, referenced by index.html)
//
// Notes:
//   • Loads the template via file:// so its relative paths (the showcase PNG)
//     resolve from scripts/. No running dev server or credentials needed.
//   • deviceScaleFactor 2 → crisp on retina; we then clip to the exact 1200×630
//     canvas so the output is precisely the declared og:image dimensions.
import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(__dirname, "og-image.template.html");
const OUT = resolve(__dirname, "..", "public", "og-image-v2.png");

const WIDTH = 1200;
const HEIGHT = 630;

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await page.goto(pathToFileURL(TEMPLATE).href, { waitUntil: "networkidle" });
  // Give the web font (DM Sans) a beat to load so text metrics are final.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  // Clip to the exact .canvas box so the PNG is precisely 1200×630.
  const canvas = page.locator(".canvas");
  await canvas.screenshot({ path: OUT });

  await browser.close();
  console.log(`Wrote ${OUT} (${WIDTH}×${HEIGHT}, @2x)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
