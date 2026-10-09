import { expect, test } from "./fixtures";
import { STANDARD_PLAN } from "../src/billing/standardPlan";

// These assertions only hold against a prerendered build (Vercel or
// `vite preview` over `dist`). The dev suite intentionally skips them, so gate
// them on the explicit suite target instead of inferring behavior from a URL.
const PRERENDERED_TARGET = ["preview", "production-smoke"].includes(
  process.env.PLAYWRIGHT_TARGET ?? process.env.PLAYWRIGHT_SUITE ?? "",
);

test.describe("technical SEO (prerendered build only)", () => {
  test.skip(!PRERENDERED_TARGET, "Run the explicit preview or production suite.");

  test("landing HTML contains hero content and a canonical link", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Vende. Kova mantiene el resto bajo control.");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('href="https://kovasuite.com/"');
    expect(html).not.toContain('<meta name="robots" content="noindex"');
    expect(html).toContain(
      '<meta property="og:title" content="Kova | Controla cada venta y entiende tu negocio" />',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Cobra, controla inventario, cuadra caja y convierte tus ventas en respuestas claras para decidir mejor. 7 días gratis, sin tarjeta." />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://kovasuite.com/og-image-v3.png" />',
    );
    expect(html).toContain('<meta property="og:image:type" content="image/png" />');
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain(
      '<meta name="twitter:image:alt" content="Laptop y teléfono muestran Caja y Análisis de Kova junto al mensaje: Cada venta. Todo bajo control." />',
    );
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
    const heroImage = html.match(/<img\b[^>]*class="lp-hero-product-capture"[^>]*>/)?.[0];
    const heroSource = heroImage?.match(/\bsrc="([^"]+)"/)?.[1];
    expect(heroSource).toBe("/showcase/kova-laptop-mobile.webp");
    expect(html).toContain(
      `<link rel="preload" as="image" href="${heroSource}" fetchpriority="high">`,
    );
    expect(html).not.toContain(
      '<link rel="preload" as="image" href="/showcase/register.png"',
    );
    // El video narrativo vive debajo del fold, por lo que sus assets pueden
    // estar en el HTML pero ninguno debe competir como preload de alta prioridad.
    expect(html).toContain("/film/kova-demo-horizontal.webp");
    expect(html).not.toMatch(/<link[^>]+rel="preload"[^>]+href="\/film\//);
  });

  test("social preview image is public and matches its declared contract", async ({ request }) => {
    const res = await request.get("/og-image-v3.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");

    const image = await res.body();
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });

  test("landing bootstrap hydrates the prerendered HTML", async ({ page }) => {
    await page.route("**/api/v1/auth/session", (route) =>
      route.fulfill({ json: { authenticated: false } }),
    );
    await page.goto("/");
    await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);
    await expect(page.locator(".lp-hero-copy")).toBeVisible();
  });

  test("favicons are public images, not the SPA HTML fallback", async ({ request }) => {
    const landing = await request.get("/");
    const html = await landing.text();
    expect(html).toContain('href="/favicon.png" sizes="96x96"');
    expect(html).toContain('href="/favicon.ico" sizes="16x16 32x32 48x48"');

    const png = await request.get("/favicon.png");
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toContain("image/png");
    const pngBody = await png.body();
    expect(pngBody.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(pngBody.readUInt32BE(16)).toBe(96);
    expect(pngBody.readUInt32BE(20)).toBe(96);

    const ico = await request.get("/favicon.ico");
    expect(ico.status()).toBe(200);
    expect(ico.headers()["content-type"]).toMatch(/^image\/(x-icon|vnd\.microsoft\.icon)/);
    const icoBody = await ico.body();
    expect(icoBody.readUInt16LE(0)).toBe(0);
    expect(icoBody.readUInt16LE(2)).toBe(1);
    expect(icoBody.readUInt16LE(4)).toBe(3);
    for (const [i, size] of [16, 32, 48].entries()) {
      const entry = 6 + i * 16;
      expect(icoBody[entry]).toBe(size);
      expect(icoBody[entry + 1]).toBe(size);
      const length = icoBody.readUInt32LE(entry + 8);
      const offset = icoBody.readUInt32LE(entry + 12);
      expect(offset + length).toBeLessThanOrEqual(icoBody.length);
      const image = icoBody.subarray(offset, offset + length);
      expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(image.readUInt32BE(16)).toBe(size);
      expect(image.readUInt32BE(20)).toBe(size);
    }
  });

  test("legal pages stay public and prerendered but are excluded from search", async ({ request }) => {
    for (const [route, title] of [
      ["/privacy", "Aviso de privacidad"],
      ["/terms", "Términos y condiciones"],
      ["/seguridad", "Seguridad"],
      ["/cookies", "Política de cookies"],
    ]) {
      const res = await request.get(route);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<title>${title} · kova</title>`);
      expect(html).toContain(`href="https://kovasuite.com${route}"`);
      expect(html).toContain('<meta name="robots" content="noindex"');
      expect(html).not.toContain('<div id="root"></div>');
    }
  });

  test("robots.txt is a real file with the sitemap directive", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("Sitemap: https://kovasuite.com/sitemap.xml");
    for (const route of ["/dashboard", "/expenses", "/pedidos", "/api/", "/kova-showcase-video"]) {
      expect(body).toContain(`Disallow: ${route}`);
    }
    expect(body).not.toContain("<!doctype html>");

    // A crawler cannot honor noindex on an already indexed URL if robots.txt
    // blocks fetching its HTML. Verify the complete public-auth exclusion path.
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapBody = await sitemap.text();
    const disallowed = body.split("\n")
      .filter((line) => line.startsWith("Disallow:"))
      .map((line) => line.slice("Disallow:".length).trim());
    for (const route of ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/accept-invite", "/privacy", "/terms", "/seguridad", "/cookies", "/favicon.png", "/favicon.ico"]) {
      expect(disallowed.some((prefix) => prefix && route.startsWith(prefix))).toBe(false);
    }
    for (const route of ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/accept-invite"]) {
      const authPage = await request.get(route);
      expect(authPage.status()).toBe(200);
      expect(await authPage.text()).toContain('<meta name="robots" content="noindex"');
      expect(sitemapBody).not.toContain(`https://kovasuite.com${route}</loc>`);
    }
  });

  test("sitemap.xml lists only the landing as a search entry point", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect([...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]))
      .toEqual(["https://kovasuite.com/"]);
  });

  test("app routes serve the empty shell, not landing content", async ({ request }) => {
    const res = await request.get("/dashboard");
    const html = await res.text();
    expect(html).not.toContain("Vende. Kova mantiene el resto bajo control.");
    expect(html).toContain('<script type="module"');
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).not.toContain('src="/hydrate-prerender.js"');
  });
});
