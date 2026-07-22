// Generate sanitized, read-only marketing captures from a populated Kova tenant.
// Credentials are accepted only through environment variables and are never
// printed or written to disk.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VIEWPORT = { width: 1440, height: 900 };
const baseUrl = (process.env.KOVA_CAPTURE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const email = process.env.KOVA_CAPTURE_EMAIL;
const password = process.env.KOVA_CAPTURE_PASSWORD;
const allowProduction = process.env.KOVA_CAPTURE_ALLOW_PRODUCTION === "1";
const baseHost = new globalThis.URL(baseUrl).hostname;

if (!email || !password) {
  throw new Error("Define KOVA_CAPTURE_EMAIL y KOVA_CAPTURE_PASSWORD para generar las capturas.");
}
if (/kovasuite\.com$/i.test(baseHost) && !allowProduction) {
  throw new Error("Las capturas de producción requieren KOVA_CAPTURE_ALLOW_PRODUCTION=1.");
}

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "showcase");
const productOutputDir = resolve(outputDir, "products");
const screens = [
  { name: "inventory", path: "/inventory", heading: "Inventario" },
  { name: "shifts", path: "/shifts", heading: "Turnos" },
  { name: "reports", path: "/reports", heading: "Reportes" },
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

async function assertPngSize(path) {
  const png = await readFile(path);
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error(`${path}: el archivo no es un PNG válido.`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
    throw new Error(`${path}: se esperaba ${VIEWPORT.width}×${VIEWPORT.height}, se obtuvo ${width}×${height}.`);
  }
}

async function captureViewport(page, name) {
  await sanitizeAccountArea(page);
  const path = resolve(outputDir, `${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await assertPngSize(path);
}

await mkdir(productOutputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
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
      blockedMutations.push(`${method} ${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/register`, { waitUntil: "networkidle" });
  await waitUntilReady(page, "Caja");
  const search = page.getByPlaceholder(/sku\s*\/\s*nombre del producto/i);

  for (const [name, fileName] of productImages) {
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
  await page.getByText("$186.00", { exact: true }).last().waitFor();
  await captureViewport(page, "register");

  for (const screen of screens) {
    await page.goto(`${baseUrl}${screen.path}`, { waitUntil: "networkidle" });
    await waitUntilReady(page, screen.heading);
    await captureViewport(page, screen.name);
  }

  if (blockedMutations.length > 0) {
    throw new Error(`La captura intentó operaciones de escritura: ${blockedMutations.join(", ")}`);
  }
} finally {
  await browser.close();
}

console.log("Capturas sanitizadas 1440×900 generadas en public/showcase/.");
