// Record a sanitized, read-only walkthrough of a populated Kova tenant as a
// video, for use as the source footage of a scroll-driven film.
//
// Same contract as capture-showcase.mjs: credentials arrive only through
// environment variables, are never printed or written to disk, and every
// request after login is forced read-only. Nothing is sold, closed, adjusted
// or written during the recording.
//
// Usage (from frontend/):
//   $env:KOVA_CAPTURE_EMAIL="<usuario>"
//   $env:KOVA_CAPTURE_PASSWORD="<contraseña>"
//   $env:KOVA_CAPTURE_BASE_URL="https://kovasuite.com"
//   $env:KOVA_CAPTURE_ALLOW_PRODUCTION="1"
//   npm run capture:film
import { chromium } from "@playwright/test";
import { mkdir, rm, readdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VIEWPORT = { width: 1440, height: 900 };
const baseUrl = (process.env.KOVA_CAPTURE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const email = process.env.KOVA_CAPTURE_EMAIL;
const password = process.env.KOVA_CAPTURE_PASSWORD;
const allowProduction = process.env.KOVA_CAPTURE_ALLOW_PRODUCTION === "1";
const baseHost = new globalThis.URL(baseUrl).hostname;

if (!email || !password) {
  throw new Error("Define KOVA_CAPTURE_EMAIL y KOVA_CAPTURE_PASSWORD para grabar la película.");
}
if (/kovasuite\.com$/i.test(baseHost) && !allowProduction) {
  throw new Error("Las grabaciones de producción requieren KOVA_CAPTURE_ALLOW_PRODUCTION=1.");
}

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "workspace", "film-source");
const videoPath = resolve(outputDir, "kova-prod-walkthrough.webm");

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Wait on the active sidebar link rather than a heading: /dashboard titles
// itself with the tenant name, not with "Panel", so a heading match would
// never resolve there.
async function settle(page, navLabel) {
  // Both the sidebar and the mobile bar can carry aria-current, so accept a
  // match on any of them rather than assuming a single active link.
  await page.waitForFunction(
    (label) => Array.from(
      globalThis.document.querySelectorAll('a[aria-current="page"]'),
      (link) => (link.textContent || "").trim(),
    ).some((text) => text.startsWith(label)),
    navLabel,
    { timeout: 30_000 },
  );
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    await Promise.all(
      Array.from(globalThis.document.images, (image) => image.complete
        ? undefined
        : new Promise((done) => {
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
          })),
    );
  });
  await page.locator(".animate-pulse").first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
}

// The account row carries the operator's email. It stays hidden for the whole
// recording, and every screen is re-checked before it is filmed.
async function hideAccount(page) {
  await page.evaluate((accountEmail) => {
    const pattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    globalThis.document.querySelectorAll("[data-capture-account]").forEach((element) => {
      element.setAttribute("aria-hidden", "true");
      element.style.visibility = "hidden";
    });
    globalThis.document.querySelectorAll("aside *").forEach((element) => {
      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === globalThis.Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ");
      if (directText.includes(accountEmail) || pattern.test(directText)) {
        const row = element.closest("[data-capture-account]") || element.parentElement?.parentElement || element;
        row.setAttribute("aria-hidden", "true");
        row.style.visibility = "hidden";
      }
    });
  }, email);

  const visibleText = await page.locator("body").innerText();
  if (EMAIL_PATTERN.test(visibleText)) {
    throw new Error("Se detectó un correo visible durante la grabación.");
  }
}

async function hold(page, ms) {
  await page.waitForTimeout(ms);
}

// Smooth, human-paced scroll. Playwright records at ~25fps, so small steps on
// a short interval read as motion rather than as jumps.
async function glide(page, distance, steps = 34, gap = 34) {
  const step = distance / steps;
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(gap);
  }
}

// Move between screens by clicking the sidebar, so navigation stays inside the
// SPA. A full reload would put a white flash between every chapter.
async function goToScreen(page, navLabel) {
  await page.getByRole("link", { name: navLabel, exact: true }).first().click();
  await settle(page, navLabel);
  await hideAccount(page);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const blockedMutations = [];

// Sign in on a context that is NOT being recorded, so no credential is ever
// typed on camera. The resulting cookies are handed to the recording context
// in memory — never written to disk.
const authContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
let storageState;
try {
  const authPage = await authContext.newPage();
  await authPage.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await authPage.getByLabel(/correo/i).fill(email);
  await authPage.getByLabel(/contrase[ñn]a/i).fill(password);
  await authPage.getByRole("button", { name: /iniciar sesi[oó]n/i }).click();
  await authPage.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });
  storageState = await authContext.storageState();
} finally {
  await authContext.close();
}

const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  storageState,
  recordVideo: { dir: outputDir, size: VIEWPORT },
});

// Strictly read-only from here. A stray sale, shift close, adjustment or any
// other write is aborted before it reaches Kova.
await context.route("**/*", async (route) => {
  const request = route.request();
  const method = request.method();
  const url = new globalThis.URL(request.url());
  const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!readOnly && (url.hostname === baseHost || url.hostname === `api.${baseHost}`)) {
    blockedMutations.push(`${method} ${url.pathname}`);
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
});

const page = await context.newPage();

try {
  // 1 — Panel: the day so far.
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" });
  await settle(page, "Panel");
  await hideAccount(page);
  await hold(page, 2200);
  await glide(page, 560);
  await hold(page, 1400);

  // 2 — Caja: build a cart. Adding to the cart is local state; "Cobrar" is a
  // write and is deliberately never pressed.
  await goToScreen(page, "Caja");
  await hold(page, 1600);
  // Take whatever the catalog offers first rather than naming products, so the
  // recording does not depend on one tenant's inventory.
  const addButtons = page.getByRole("button", { name: /^Agregar / });
  await addButtons.first().waitFor({ timeout: 20_000 });
  const available = Math.min(2, await addButtons.count());
  for (let i = 0; i < available; i += 1) {
    await addButtons.nth(i).click();
    await hold(page, 1100);
  }
  await hold(page, 1500);
  await page.getByRole("button", { name: /^Efectivo$/i }).first().click().catch(() => {});
  await hold(page, 1800);

  // 3 — Inventario: what is about to run out.
  await goToScreen(page, "Inventario");
  await hold(page, 2200);
  await glide(page, 620);
  await hold(page, 1400);

  // 4 — Turnos: the corte de caja.
  await goToScreen(page, "Turnos");
  await hold(page, 2200);
  await glide(page, 560);
  await hold(page, 1600);

  // 5 — Análisis: the story of the period.
  await goToScreen(page, "Análisis");
  await hold(page, 2400);
  await glide(page, 900, 46);
  await hold(page, 2400);

  if (blockedMutations.length > 0) {
    throw new Error(`La grabación intentó operaciones de escritura: ${blockedMutations.join(", ")}`);
  }
} finally {
  await context.close();  // flushes the video file
  await browser.close();
}

const written = (await readdir(outputDir)).filter((file) => file.endsWith(".webm"));
if (written.length !== 1) {
  throw new Error(`Se esperaba un solo video, se encontraron ${written.length}.`);
}
await rename(resolve(outputDir, written[0]), videoPath);

console.log(`Película sanitizada grabada en workspace/film-source/ a ${VIEWPORT.width}×${VIEWPORT.height}.`);
console.log("Sin escrituras: no se cobró ninguna venta, no se cerró ningún turno, no se ajustó inventario.");
