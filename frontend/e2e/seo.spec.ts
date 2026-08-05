import { expect, test } from "@playwright/test";

// These assertions only hold against a prerendered build (Vercel or
// `vite preview` over `dist`). The default Playwright webServer is the dev
// server, which doesn't prerender, so gate them on an explicit base URL —
// same pattern as production-smoke.spec.ts.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;

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
    expect(html).toContain('"price":"299"');
    expect(html).not.toContain('"@type":"FAQPage"');
    expect(html).toContain('src="/hydrate-prerender.js"');
    expect(html).not.toContain('rel="modulepreload"');
    // El póster del HeroFilm es el candidato a LCP: ambas variantes van
    // preloaded con media queries mutuamente excluyentes y fetchpriority alto.
    expect(html).toMatch(
      /<link rel="preload" as="image" href="\/film\/mobile\/frame-\d{4}\.webp" media="\(max-width: 860px\)" fetchpriority="high">/,
    );
    expect(html).toMatch(
      /<link rel="preload" as="image" href="\/film\/desktop\/frame-\d{4}\.webp" media="\(min-width: 861px\)" fetchpriority="high">/,
    );
  });

  test("landing bootstrap hydrates the prerendered HTML", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);
    await expect(page.locator(".lp-hero-copy")).toBeVisible();
  });

  test("legal pages are prerendered with their own title", async ({ request }) => {
    const res = await request.get("/privacy");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Aviso de privacidad");
    expect(html).toContain('href="https://kovasuite.com/privacy"');
  });

  test("robots.txt is a real file with the sitemap directive", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("Sitemap: https://kovasuite.com/sitemap.xml");
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
    const res = await request.get("/dashboard");
    const html = await res.text();
    expect(html).not.toContain("Conoce exactamente");
    expect(html).toContain('<script type="module"');
    expect(html).not.toContain('src="/hydrate-prerender.js"');
  });
});
