import { expect, test } from "./fixtures";
import { createRequire } from "node:module";
import type { AxeResults } from "axe-core";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

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
    const tour = page.locator("#producto");
    for (const [index, screen] of ["register", "inventory", "shifts", "reports"].entries()) {
      await tour.getByRole("tab").nth(index).click();
      const image = tour.getByRole("tabpanel").getByRole("img");
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
      expect(await image.evaluate((node: HTMLImageElement) => new URL(node.currentSrc).pathname)).toBe(`/showcase/current/${width === 390 ? "mobile/" : ""}${screen}.jpg`);
    }
    await expect(tour.getByRole("link", { name: "Probar Kova gratis" })).toHaveAttribute("href", "/signup");
    await page.getByRole("button", { name: "¿Cómo puedo contactar a soporte?" }).click();
    await expect(page.locator("main")).not.toContainText(/beta|piloto|en desarrollo|próximamente|demo completada/i);
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
