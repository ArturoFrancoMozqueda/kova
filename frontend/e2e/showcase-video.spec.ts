// Anatomía de KovaShowcase en su única superficie viva: la ruta aislada
// /kova-showcase-video (export para grabación social). Estos dos specs vivían
// en mobile.spec.ts apuntando a "/", pero el showcase salió de la landing
// cuando el film del producto se convirtió en el hero.
import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// La variante standalone difiere a propósito del embebido que este spec
// cubría en "/": oculta los controles de escena y fuerza el auto-avance
// incluso bajo reduced-motion (forceMotion — es una superficie de grabación,
// el movimiento ES su propósito). Se verifica la anatomía real del register
// y que el recorrido avanza solo hasta la escena de inventario.
test("showcase export keeps the register anatomy and auto-advances scenes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto("/kova-showcase-video");

  const showcase = page.locator(".ksw-stage");
  await showcase.scrollIntoViewIfNeeded();
  await expect(showcase).toHaveAttribute("data-hydrated", "true");
  await expect(showcase.getByText("Demo interactiva", { exact: true })).toBeVisible();
  await expect(showcase.getByText(/no registra ventas/i)).toBeVisible();
  await expect(showcase.getByPlaceholder(/sku \/ nombre del producto/i)).toBeVisible();
  await expect(showcase.getByText("Cold brew", { exact: true }).first()).toBeVisible();
  await expect(showcase.locator('.ksw-screen-layer[data-active="true"]')).toHaveCount(1);
  // Auto-avance (~6 s por escena): la captura real de inventario toma el stage.
  await expect(
    showcase.locator('.ksw-screen-layer[data-active="true"] img[src="/showcase/inventory.png"]'),
  ).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalOverflow(page);
});

test("landscape showcase product cards use container width without overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto("/kova-showcase-video?format=landscape");

  const showcase = page.locator(".ksw-stage");
  await showcase.scrollIntoViewIfNeeded();
  await expect(showcase).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByPlaceholder(/sku \/ nombre del producto/i)).toHaveCount(1);

  const geometry = await showcase.locator("[data-showcase-product]").evaluateAll((elements) => {
    const rectangles = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const overlap = rectangles.some((first, index) => rectangles.slice(index + 1).some((second) =>
      first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top,
    ));
    return {
      overlap,
      widths: elements.map((element) => Number.parseFloat(getComputedStyle(element).width)),
      demoOverflow: (() => {
        const demo = elements[0]?.closest(".lp-pos-container");
        return demo ? demo.scrollWidth - demo.clientWidth : 0;
      })(),
    };
  });

  expect(geometry.overlap).toBe(false);
  expect(Math.min(...geometry.widths)).toBeGreaterThanOrEqual(180);
  expect(geometry.demoOverflow).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
});
