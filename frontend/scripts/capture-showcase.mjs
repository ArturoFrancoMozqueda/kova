// Generate sanitized, read-only marketing captures from a populated Kova tenant.
// Credentials are accepted only through environment variables and are never
// printed or written to disk.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Desktop keeps the published 1440×900 assets; mobile emulates a touch phone
// and writes to public/showcase/mobile/ without replacing desktop captures.
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, dir: "" },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, dir: "mobile" },
};
const requestedDevices = (process.env.KOVA_CAPTURE_DEVICES || "desktop,mobile")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const baseUrl = (process.env.KOVA_CAPTURE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const email = process.env.KOVA_CAPTURE_EMAIL;
const password = process.env.KOVA_CAPTURE_PASSWORD;
const allowProduction = process.env.KOVA_CAPTURE_ALLOW_PRODUCTION === "1";
const baseHost = new globalThis.URL(baseUrl).hostname;

if (!email || !password) {
  throw new Error("Define KOVA_CAPTURE_EMAIL y KOVA_CAPTURE_PASSWORD para generar las capturas.");
}
const unknownDevice = requestedDevices.find((name) => !DEVICES[name]);
if (unknownDevice || requestedDevices.length === 0) {
  throw new Error("KOVA_CAPTURE_DEVICES admite sólo desktop y/o mobile.");
}
if (/kovasuite\.com$/i.test(baseHost) && !allowProduction) {
  throw new Error("Las capturas de producción requieren KOVA_CAPTURE_ALLOW_PRODUCTION=1.");
}

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "showcase");
const productOutputDir = resolve(outputDir, "products");
const screens = [
  { name: "inventory", path: "/inventory", heading: "Inventario" },
  { name: "shifts", path: "/shifts", heading: "Turnos" },
  { name: "reports", path: "/reports", heading: "Análisis" },
];
const productImages = [
  ["Agua mineral", "agua-mineral.png"],
  ["Alfajores", "alfajores.png"],
  ["Capuchino mediano", "capuchino-mediano.png"],
  ["Chocolate frío", "chocolate-frio.png"],
  ["Cold brew", "cold-brew.png"],
  ["Concha vainilla", "concha-vainilla.png"],
  ["Croissant mantequilla", "croissant-mantequilla.png"],
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitUntilReady(page, heading) {
  await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 30_000 });
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

async function sanitizeAccountArea(page) {
  await page.evaluate((accountEmail) => {
    globalThis.document.querySelectorAll("[data-capture-account]").forEach((element) => {
      element.setAttribute("aria-hidden", "true");
      element.style.visibility = "hidden";
    });

    // Production may not yet include the capture hooks. Find the direct text
    // node instead and hide its account row without touching the tenant name.
    const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    globalThis.document.querySelectorAll("aside *").forEach((element) => {
      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === globalThis.Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ");
      if (directText.includes(accountEmail) || emailPattern.test(directText)) {
        const row = element.closest("[data-capture-account]") || element.parentElement?.parentElement || element;
        row.setAttribute("aria-hidden", "true");
        row.style.visibility = "hidden";
      }
    });
  }, email);

  const visibleText = await page.locator("body").innerText();
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(visibleText)) {
    throw new Error("Se detectó un correo visible después de sanitizar la captura.");
  }
}

async function assertPngSize(path, device) {
  const png = await readFile(path);
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error(`${path}: el archivo no es un PNG válido.`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const expectedWidth = device.viewport.width * device.deviceScaleFactor;
  const expectedHeight = device.viewport.height * device.deviceScaleFactor;
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${path}: se esperaba ${expectedWidth}×${expectedHeight}, se obtuvo ${width}×${height}.`);
  }
}

async function captureViewport(page, device, name) {
  await sanitizeAccountArea(page);
  const path = resolve(outputDir, device.dir, `${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await assertPngSize(path, device);
}

async function captureDevice(browser, device) {
  await mkdir(resolve(outputDir, device.dir), { recursive: true });
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    reducedMotion: "reduce",
  });
  // First-use tours are remembered only in localStorage. Treat them as seen so
  // they do not cover Caja; nothing is written to the tenant.
  await context.addInitScript(() => {
    const getItem = globalThis.Storage.prototype.getItem;
    globalThis.Storage.prototype.getItem = function (key) {
      return String(key).startsWith("kova:tour:") ? "1" : getItem.call(this, key);
    };
  });
  const page = await context.newPage();
  const blockedMutations = [];

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel(/correo/i).fill(email);
    await page.getByLabel(/contrase[ñn]a/i).fill(password);
    await page.getByRole("button", { name: /iniciar sesi[oó]n/i }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });

    // From this point forward the capture session is strictly read-only. An
    // accidental product write, sale, shift close, adjustment or report action
    // is aborted before it reaches Kova.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new globalThis.URL(request.url());
      const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
      if (!readOnly && (url.hostname === baseHost || url.hostname === `api.${baseHost}`)) {
        // Telemetry is dropped so capture runs never count as product usage;
        // any other write is reported and fails the run.
        if (!url.pathname.startsWith("/api/v1/telemetry/")) {
          blockedMutations.push(`${method} ${url.pathname}`);
        }
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/register`, { waitUntil: "networkidle" });
    await waitUntilReady(page, "Caja");
    const search = page.getByPlaceholder(/sku\s*\/\s*nombre del producto/i);

    // Product photos for the local demo come from the desktop grid only.
    for (const [name, fileName] of device.isMobile ? [] : productImages) {
      await search.fill(name);
      const card = page.getByRole("button", { name: new RegExp(`^Agregar ${escapeRegex(name)}$`, "i") });
      await card.waitFor();
      const image = card.locator("img");
      await image.waitFor();
      await image.screenshot({ path: resolve(productOutputDir, fileName), animations: "disabled" });
    }

    for (const name of ["Cold brew", "Capuchino mediano", "Yogurt con granola"]) {
      await search.fill(name);
      await page.getByRole("button", { name: new RegExp(`^Agregar ${escapeRegex(name)}$`, "i") }).click();
    }
    await search.fill("");
    // On mobile the cart is a collapsed sheet, so the total exists without being visible.
    await page.getByText("$186.00", { exact: true }).last().waitFor({ state: "attached" });
    await captureViewport(page, device, "register");

    for (const screen of screens) {
      await page.goto(`${baseUrl}${screen.path}`, { waitUntil: "networkidle" });
      await waitUntilReady(page, screen.heading);
      await captureViewport(page, device, screen.name);
    }

    if (blockedMutations.length > 0) {
      throw new Error(`La captura intentó operaciones de escritura: ${blockedMutations.join(", ")}`);
    }
  } finally {
    await context.close();
  }
}

await mkdir(productOutputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const name of requestedDevices) {
    await captureDevice(browser, DEVICES[name]);
  }
} finally {
  await browser.close();
}

console.log(`Capturas sanitizadas (${requestedDevices.join(", ")}) generadas en public/showcase/.`);
