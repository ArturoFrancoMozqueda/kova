// Generate sanitized marketing captures from a seeded Kova tenant.
// Credentials are accepted only through environment variables and are never
// printed or written to disk.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.KOVA_CAPTURE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const email = process.env.KOVA_CAPTURE_EMAIL;
const password = process.env.KOVA_CAPTURE_PASSWORD;
const allowProduction = process.env.KOVA_CAPTURE_ALLOW_PRODUCTION === "1";

if (!email || !password) {
  throw new Error("Define KOVA_CAPTURE_EMAIL y KOVA_CAPTURE_PASSWORD para generar las capturas.");
}
if (/kovasuite\.com$/i.test(new globalThis.URL(baseUrl).hostname) && !allowProduction) {
  throw new Error("Las capturas de producción requieren KOVA_CAPTURE_ALLOW_PRODUCTION=1.");
}

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "showcase");
const screens = [
  { name: "inventory", path: "/inventory", heading: "Inventario" },
  { name: "shifts", path: "/shifts", heading: "Turnos" },
  { name: "reports", path: "/reports", heading: "Reportes" },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  globalThis.localStorage.setItem("kova-sidebar-collapsed", "1");
});
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/correo/i).fill(email);
  await page.getByLabel(/contrase[ñn]a/i).fill(password);
  await page.getByRole("button", { name: /iniciar sesi[óo]n/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });

  for (const screen of screens) {
    await page.goto(`${baseUrl}${screen.path}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: screen.heading, exact: true }).waitFor();
    await page.waitForTimeout(900);

    const main = page.locator("main");
    const visibleText = await main.innerText();
    if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(visibleText)) {
      throw new Error(`${screen.name}: se detectó un correo en el área capturable.`);
    }
    await main.screenshot({ path: resolve(outputDir, `${screen.name}.png`) });
  }
} finally {
  await browser.close();
}

console.log("Capturas sanitizadas generadas en public/showcase/.");
