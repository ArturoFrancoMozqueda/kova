// Render composition.html frame by frame.
//   node scripts/film/render.mjs h|v [--stills t1,t2,...]   (from frontend/)
import { chromium } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const orientation = process.argv[2] === "v" ? "v" : "h";
const stillsArg = process.argv.indexOf("--stills");
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(",").map(Number) : null;
const FPS = 30;
const size = orientation === "h" ? { width: 1600, height: 900, scale: 1.2 } : { width: 720, height: 1280, scale: 1.5 };

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: size.width, height: size.height },
  deviceScaleFactor: size.scale,
});
await page.goto(`file://${resolve(here, "composition.html")}?o=${orientation}`);
await page.evaluate(() => globalThis.ready);
const duration = await page.evaluate(() => globalThis.DURATION);

// Renders go to the git-ignored workspace/ at the repo root.
const outRoot = resolve(here, "..", "..", "..", "workspace", "film");
const outDir = resolve(outRoot, stills ? `stills-${orientation}` : `frames-${orientation}`);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const times = stills ?? Array.from({ length: Math.round(duration * FPS) }, (_, i) => i / FPS);
for (const [index, t] of times.entries()) {
  await page.evaluate((time) => globalThis.render(time), t);
  const name = stills ? `t${String(t).replace(".", "_")}.jpg` : `f${String(index).padStart(5, "0")}.jpg`;
  await page.screenshot({ path: resolve(outDir, name), type: "jpeg", quality: 93 });
  if (!stills && index % 150 === 0) console.log(`${orientation} frame ${index}/${times.length}`);
}

if (!stills) {
  const sfx = await page.evaluate(() => globalThis.SFX);
  await writeFile(resolve(outRoot, `sfx-${orientation}.json`), JSON.stringify(sfx, null, 1));
}
await browser.close();
console.log(`done ${orientation} → ${outDir}`);
