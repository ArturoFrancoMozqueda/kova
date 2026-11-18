import { expect, test } from "./fixtures";
import { createRequire } from "node:module";
import type { AxeResults } from "axe-core";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

test.beforeEach(async ({ page }) => {
  const core = ["pos", "inventory", "sales_reports", "public_catalog"];
  await page.route("**/api/v1/billing/plans", route => route.fulfill({ json: {
    offer_revision: "tiered", tiered_pricing_enabled: true, available_plans: [
      { code: "esencial", name: "Esencial", amount_minor_units: 39900, currency: "MXN", interval: "month", tax_inclusive: true, features: core, limits: { branches: 1, product_image_bytes: 250_000_000 } },
      { code: "gestion", name: "Gestión", amount_minor_units: 69900, currency: "MXN", interval: "month", tax_inclusive: true, features: [...core, "advanced_reports", "purchasing", "customer_orders", "quotes", "loyalty"], limits: { branches: 1, product_image_bytes: 1_073_741_824 } },
    ],
  } }));
});

for (const width of [390, 1440]) {
  test(`landing shows current product screens and production copy at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
    const mutations: string[] = [];
    page.on("request", request => {
      if (request.method() !== "GET" && /\/api\/v1\/(orders|inventory|shifts)(?:\/|$)/.test(request.url())) mutations.push(request.url());
    });
    await page.goto("/");
    await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Toda tu operación, más fácil.");
    for (const image of await page.locator(".lp-hero-frame img").all()) {
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      expect(await image.getAttribute("src")).toContain("/showcase/current/");
    }
    const sectionOrder = await page.locator("main > section[id]").evaluateAll(nodes => nodes.map(node => node.id));
    expect(sectionOrder[0]).toBe("reportes");
    const ownerPanel = page.getByRole("region", { name: "Tu negocio, de un vistazo." });
    const panelImage = ownerPanel.getByRole("img");
    await panelImage.scrollIntoViewIfNeeded();
    await expect.poll(() => panelImage.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await panelImage.evaluate((node: HTMLImageElement) => new URL(node.currentSrc).pathname)).toBe(`/showcase/current/${width === 390 ? "mobile/" : ""}dashboard.jpg`);
    const tour = page.locator("#producto");
    for (const [index, screen] of ["register", "inventory", "shifts", "reports"].entries()) {
      await tour.getByRole("tab").nth(index).click();
      const image = tour.getByRole("tabpanel").getByRole("img");
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      expect(await image.evaluate((node: HTMLImageElement) => new URL(node.currentSrc).pathname)).toBe(`/showcase/current/${width === 390 ? "mobile/" : ""}${screen}.jpg`);
    }
    await expect(tour.getByRole("link", { name: "Probar Kova gratis" })).toHaveAttribute("href", "/signup");
    await expect(tour.getByRole("button", { name: /Pausar recorrido|Reproducir recorrido/ })).toHaveCount(0);
    await page.getByRole("button", { name: "¿Cómo puedo contactar a soporte?" }).click();
    await expect(page.locator("main")).not.toContainText(/beta|piloto|en desarrollo|próximamente|demo completada|datos de ejemplo/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(mutations).toEqual([]);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const axe = (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
    });
    expect(violations).toEqual([]);
  });
}

test("landing animations finish once and pricing preserves the confirmed amounts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
  await page.goto("/");
  await expect(page.locator(".lp-root")).toHaveClass(/lp-motion-ready/);
  const flow = page.locator("#problema [data-lp-reveal-opt]");
  await flow.scrollIntoViewIfNeeded();
  await expect(flow).toHaveAttribute("data-lp-visible", "true");
  await expect.poll(() => flow.locator("svg path").first().evaluate(node => getComputedStyle(node).animationName)).toContain("lp-flow-connect");
  const flowTimings = await flow.evaluate(node => node.getAnimations({ subtree: true }).map(animation => animation.effect?.getTiming()));
  expect(flowTimings.length).toBeGreaterThan(0);
  expect(flowTimings.every(timing => timing?.iterations === 1 && Number(timing.duration) + Number(timing.delay) < 5000)).toBe(true);

  const pricing = page.locator("#precio");
  await pricing.scrollIntoViewIfNeeded();
  await expect(pricing).toHaveAttribute("data-lp-pricing-visible", "true");
  await expect(pricing.locator(".lp-plan-price").nth(0)).toHaveText("$399 MXN/mes");
  await expect(pricing.locator(".lp-plan-price").nth(1)).toHaveText("$699 MXN/mes");
  const timings = await pricing.evaluate(node => node.getAnimations({ subtree: true }).map(animation => animation.effect?.getTiming()));
  expect(timings.length).toBeGreaterThan(0);
  expect(timings.every(timing => timing?.iterations === 1 && Number(timing.duration) + Number(timing.delay) < 5000)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await pricing.locator(".lp-plan").first().evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  expect(await flow.locator("svg path").first().evaluate(node => getComputedStyle(node).animationName)).toBe("none");
});
