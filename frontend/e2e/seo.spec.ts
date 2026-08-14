import { expect, test } from "./fixtures";
import { STANDARD_PLAN } from "../src/billing/standardPlan";

// These assertions only hold against a prerendered build (Vercel or
// `vite preview` over `dist`). The default Playwright webServer is the dev
// server, which doesn't prerender, so gate them on an explicit base URL —
// same pattern as production-smoke.spec.ts.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL
  ?? (process.env.PLAYWRIGHT_USE_PREVIEW === "1" ? "http://127.0.0.1:5174" : undefined);

test.describe("technical SEO (prerendered build only)", () => {
  test.skip(!BASE_URL, "Set PLAYWRIGHT_BASE_URL to run against a prerendered build.");

  test("landing HTML contains hero content and a canonical link", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Vende. Kova mantiene el resto bajo control.");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('href="https://kovasuite.com/"');
    // El JSON-LD describe la organización y su aplicación, incluida la oferta.
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain(`"price":"${STANDARD_PLAN.amountMinorUnits / 100}"`);
    expect(html).toContain(`"priceCurrency":"${STANDARD_PLAN.currency}"`);
    expect(html).not.toContain('"@type":"FAQPage"');
    expect(html).toContain('src="/hydrate-prerender.js"');
    expect(html).not.toContain('rel="modulepreload"');
    // La captura de HeroProductFrame es el LCP en todos los viewports: va
    // preloaded una sola vez, sin media query, con fetchpriority alto.
    expect(html).toMatch(
      /<link rel="preload" as="image" href="\/showcase\/register\.png" fetchpriority="high">/,
    );
    // Los frames del film ya no se renderizan: no deben competir por prioridad.
    expect(html).not.toContain("/film/");
  });

  test("landing bootstrap hydrates the prerendered HTML", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);
    await expect(page.locator(".lp-hero-copy")).toBeVisible();
  });

  test("legal pages are prerendered with their own title", async ({ request }) => {
    const privacyPath = process.env.PLAYWRIGHT_BASE_URL ? "/privacy" : "/privacy/index.html";
    const res = await request.get(privacyPath);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Aviso de privacidad");
    expect(html).toContain('href="https://kovasuite.com/privacy"');
    expect(html).not.toContain('<meta name="robots" content="noindex"');
  });

  test("robots.txt is a real file with the sitemap directive", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("Sitemap: https://kovasuite.com/sitemap.xml");
    for (const route of ["/login", "/signup", "/expenses", "/pedidos", "/kova-showcase-video"]) {
      expect(body).toContain(`Disallow: ${route}`);
    }
    expect(body).not.toContain("<!doctype html>");
  });

  test("sitemap.xml lists the public marketing and legal URLs", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    for (const loc of ["/", "/privacy", "/terms", "/seguridad", "/cookies"]) {
      expect(body).toContain(`https://kovasuite.com${loc === "/" ? "/" : loc}</loc>`);
    }
  });

  test("app routes serve the empty shell, not landing content", async ({ request }) => {
    // Vite preview does not apply vercel.json rewrites, so inspect the emitted
    // shell directly there. A deployed run still verifies the real rewrite.
    const appPath = process.env.PLAYWRIGHT_BASE_URL ? "/dashboard" : "/app-shell.html";
    const res = await request.get(appPath);
    const html = await res.text();
    expect(html).not.toContain("Vende. Kova mantiene el resto bajo control.");
    expect(html).toContain('<script type="module"');
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).not.toContain('src="/hydrate-prerender.js"');
  });
});
