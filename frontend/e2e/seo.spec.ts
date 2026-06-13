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
    expect(html).toContain("Conoce exactamente");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('href="https://kovasuite.com/"');
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
  });
});
