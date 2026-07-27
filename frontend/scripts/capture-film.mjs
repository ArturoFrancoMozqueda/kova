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
// Opt-in, off by default. When set, the recording completes a real sale so the
// film can show the "Venta completada" state. This writes one order to the
// tenant, moves stock and lands in reports and the corte de caja.
const allowSale = process.env.KOVA_CAPTURE_ALLOW_SALE === "1";
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
  // Wait for every skeleton, not just the first: Análisis renders several and
  // filming while they are still pulsing produces grey placeholder footage.
  await page
    .waitForFunction(() => !globalThis.document.querySelector(".animate-pulse"), undefined, { timeout: 25_000 })
    .catch(() => {});
}

// The first-run coach-mark ("Caja lista para tu primera venta") sits on top of
// the cart. Clear it before filming, and stay quiet if it never appeared.
async function dismissCoachmark(page) {
  const done = page.getByRole("button", { name: /^Entendido$/i }).first();
  if (await done.isVisible().catch(() => false)) {
    await done.click().catch(() => {});
    await page.waitForTimeout(600);
  }
}

// Period toggles default to "today". On a quiet day that renders an empty
// state, so the film would show the product with nothing in it.
async function selectPeriod(page, label) {
  // Panel renders its period control as radios, Análisis as buttons, so match
  // on the accessible name across roles rather than assuming one of them.
  const name = new RegExp(`^${label}$`, "i");
  const control = page
    .getByRole("radio", { name })
    .or(page.getByRole("button", { name }))
    .or(page.getByRole("tab", { name }))
    .first();
  await control.waitFor({ timeout: 15_000 });
  await control.click();
  await page.waitForLoadState("networkidle");
  await page
    .waitForFunction(() => !globalThis.document.querySelector(".animate-pulse"), undefined, { timeout: 25_000 })
    .catch(() => {});
  await page.waitForTimeout(900);
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

// Analytics-only endpoints. These are still aborted — a synthetic capture
// session must not land in production telemetry — but they carry no business
// effect, so they do not invalidate the recording. Everything else that is not
// a read still fails the run.
const ANALYTICS_ONLY = /^\/api\/v1\/telemetry\//;

// Exactly the order-creation endpoint, and only with KOVA_CAPTURE_ALLOW_SALE.
// Refunds (/{id}/refunds) and voids (/{id}/void) stay blocked: the trailing
// anchor makes sure no subpath slips through.
const SALE_ENDPOINT = /^\/api\/v1\/orders\/?$/;

const browser = await chromium.launch({ headless: true });
const blockedMutations = [];
const blockedAnalytics = [];
const recordedSales = [];

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
    if (allowSale && method === "POST" && SALE_ENDPOINT.test(url.pathname)) {
      recordedSales.push(`${method} ${url.pathname}`);
      await route.continue();
      return;
    }
    const bucket = ANALYTICS_ONLY.test(url.pathname) ? blockedAnalytics : blockedMutations;
    bucket.push(`${method} ${url.pathname}`);
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
});

const page = await context.newPage();

try {
  // 1 — Panel: the business, over a period that actually has sales.
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" });
  await settle(page, "Panel");
  await dismissCoachmark(page);
  await hideAccount(page);
  await selectPeriod(page, "Esta semana");
  await hideAccount(page);
  await hold(page, 1800);
  await glide(page, 560);
  await hold(page, 1200);

  // 2 — Caja: build a cart. Adding to the cart is local state; "Cobrar" is a
  // write and is deliberately never pressed.
  await goToScreen(page, "Caja");
  await dismissCoachmark(page);
  await hold(page, 1200);
  // Take whatever the catalog offers first rather than naming products, so the
  // recording does not depend on one tenant's inventory.
  const addButtons = page.getByRole("button", { name: /^Agregar / });
  await addButtons.first().waitFor({ timeout: 20_000 });
  const available = Math.min(2, await addButtons.count());
  for (let i = 0; i < available; i += 1) {
    await addButtons.nth(i).click();
    await hold(page, 1100);
  }
  await hold(page, 1400);

  // Transferencia over Efectivo: it enables "Cobrar" straight away, where cash
  // first demands the amount received.
  await page.getByRole("button", { name: /^Transferencia$/i }).first().click();
  await hold(page, 1400);

  if (allowSale) {
    const charge = page.getByRole("button", { name: /^Cobrar$/i }).first();
    await charge.waitFor({ timeout: 15_000 });
    await charge.click();
    // The real success state: total, receipt and "Nueva venta".
    await page.getByText(/Venta completada/i).first().waitFor({ timeout: 30_000 });
    await hideAccount(page);
    await hold(page, 2600);
    await glide(page, 320, 18);
    await hold(page, 1600);
  } else {
    await hold(page, 1600);
  }

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

  // 5 — Análisis: the story of the period. This view has no "Esta semana";
  // its week option is labelled "7 días".
  await goToScreen(page, "Análisis");
  await selectPeriod(page, "7 días");
  await hideAccount(page);
  await hold(page, 2200);
  await glide(page, 900, 46);
  await hold(page, 2000);

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
if (recordedSales.length > 0) {
  console.log(`ATENCIÓN: se registró ${recordedSales.length} venta real en el tenant (POST /api/v1/orders).`);
  console.log("Descuenta inventario y aparece en Órdenes, Análisis y el corte de caja.");
  console.log("Si no la quieres en tus números, cancélala desde Órdenes.");
} else {
  console.log("Sin escrituras: no se cobró ninguna venta, no se cerró ningún turno, no se ajustó inventario.");
}
if (blockedAnalytics.length > 0) {
  console.log(`Telemetría bloqueada (${blockedAnalytics.length} evento(s)): la sesión no aparece en la analítica de producción.`);
}
