// Capture REAL Kova product screenshots for the marketing showcase.
//
// Logs into a running Kova instance with YOUR credentials, visits the four
// story screens, and writes PNGs to frontend/public/showcase/ — which
// landing/showcase/KovaShowcase.tsx then displays inside the laptop mockup.
//
// ── SECURITY ───────────────────────────────────────────────────────────────
// Credentials are read from environment variables ONLY and are never written to
// disk or committed. The captured PNGs (marketing assets) are committed; your
// email/password are not.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//   1. Have a Kova instance running with your real, populated tenant. That can
//      be production (e.g. https://kovasuite.com) or a local stack.
//   2. From /frontend, run (PowerShell):
//        $env:KOVA_BASE_URL="https://kovasuite.com"
//        $env:KOVA_EMAIL="you@yourbusiness.mx"
//        $env:KOVA_PASSWORD="••••••••"
//        npm run capture:showcase
//      (bash:  KOVA_BASE_URL=… KOVA_EMAIL=… KOVA_PASSWORD=… npm run capture:showcase)
//   3. The four PNGs in public/showcase/ are overwritten with your real screens.
//      Commit them. Re-run any time the product UI changes.
//
// Notes:
//   • Captures the full app (AppShell sidebar + content) at 1440×900 @2x so the
//     images look crisp inside the laptop and read as the real product.
//   • Owner/manager accounts see all four screens. A cashier-only account will
//     not have access to /dashboard or /inventory.
//   • First-use tours are auto-dismissed (capture-only localStorage shim).
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const BASE_URL = (process.env.KOVA_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const EMAIL = process.env.KOVA_EMAIL;
const PASSWORD = process.env.KOVA_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "Missing credentials. Set KOVA_EMAIL and KOVA_PASSWORD (and optionally " +
      "KOVA_BASE_URL) in your environment before running. They are never stored.",
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "showcase");

// Story beats → routes. Filenames match the <img> srcs in KovaShowcase.tsx.
const SCREENS = [
  { name: "pos", path: "/register" },
  { name: "inventory", path: "/inventory" },
  { name: "caja", path: "/shifts" },
  { name: "panel", path: "/dashboard" },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });

  // Capture-only shim: treat every first-use tour as already seen so the
  // onboarding modal never overlays the screenshots. (Does not touch app code.)
  await context.addInitScript(() => {
    // Runs in the browser; reference the global via globalThis so Node-side
    // linting doesn't flag the browser-only `Storage` symbol.
    const proto = globalThis.Storage.prototype;
    const orig = proto.getItem;
    proto.getItem = function (key) {
      // Treat first-use tours AND the onboarding "all done" celebration as
      // already seen, so neither overlays nor precedes the real screens.
      if (typeof key === "string" &&
          (key.startsWith("kova:tour:") || key.startsWith("kova-onboarding-celebrated"))) {
        return "1";
      }
      return orig.call(this, key);
    };
  });

  const page = await context.newPage();

  // ── Log in ────────────────────────────────────────────────────────────────
  console.log(`Logging in at ${BASE_URL} as ${EMAIL} …`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/correo/i).fill(EMAIL);
  await page.getByLabel(/contrase[ñn]a/i).fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesi[óo]n/i }).click();

  // Owners/managers land on /dashboard; wait until we leave /login.
  try {
    await page.waitForURL((url) => !url.pathname.replace(/\/$/, "").endsWith("/login"), {
      timeout: 20000,
    });
  } catch {
    console.error(
      "Login did not complete (still on /login). Check the credentials and " +
        "that KOVA_BASE_URL points at a running instance.",
    );
    await browser.close();
    process.exit(1);
  }
  console.log("Logged in.");

  // ── Capture each screen ─────────────────────────────────────────────────────
  let captured = 0;
  for (const screen of SCREENS) {
    const url = `${BASE_URL}${screen.path}`;
    await page.goto(url, { waitUntil: "networkidle" });
    // Settle charts, CountUp animations, lazy images.
    await page.waitForTimeout(2200);

    if (page.url().replace(/\/$/, "").endsWith("/login")) {
      console.warn(`! Skipped ${screen.name}: redirected to login (no access?).`);
      continue;
    }

    // POS reads best mid-sale: add a few products so the cart shows a real
    // total + payment options instead of an empty "carrito vacío" state.
    if (screen.name === "pos") {
      const addButtons = page.getByRole("button", { name: /^Agregar /i });
      const count = await addButtons.count();
      for (let i = 0; i < Math.min(3, count); i += 1) {
        await addButtons.nth(i).click();
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(800);
    }

    // Panel: lead with the analytics (KPI cards + business health + charts)
    // rather than the trial banner / setup hints up top.
    if (screen.name === "panel") {
      try {
        const anchor = page.getByText(/Ventas netas/i).first();
        await anchor.waitFor({ timeout: 4000 });
        // AppShell scrolls inside its own container, so scroll the element
        // itself to the top of its scroll parent (window.scrollBy is a no-op).
        await anchor.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
        await page.waitForTimeout(900);
      } catch {
        // KPIs not found (no sales?) — leave the page at the top.
      }
    }

    const file = resolve(OUT_DIR, `${screen.name}.png`);
    await page.screenshot({ path: file }); // viewport only — reads like a screen
    console.log(`✓ ${screen.name.padEnd(10)} → public/showcase/${screen.name}.png`);
    captured += 1;
  }

  await browser.close();
  console.log(`\nDone. Captured ${captured}/${SCREENS.length} screens into public/showcase/.`);
  if (captured < SCREENS.length) {
    console.log("Some screens were skipped — check account role/permissions.");
  }
}

main().catch((err) => {
  console.error("Capture failed:", err?.message || err);
  process.exit(1);
});
