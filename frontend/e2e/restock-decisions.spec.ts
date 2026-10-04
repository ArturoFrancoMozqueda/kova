import { type Page, expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { makeStory } from "../src/reports/__fixtures__/story";
import { createRequire } from "node:module";
import type { AxeResults } from "axe-core";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

async function mockBusiness(page: Page, role = "owner", otherNeedsReview = false) {
  await markFirstUseToursSeen(page);
  let onHand = 10;
  const writes: unknown[] = [];
  const stock = () => [{
    product_id: "p1", product_name: "Leche", sku: "LEC", track_inventory: true,
    stock_on_hand: onHand, reserved_quantity: 4, available_quantity: Math.max(0, onHand - 4),
    low_stock_threshold: 3, is_low_stock: onHand - 4 <= 3,
  }, {
    product_id: "p2", product_name: "Vasos", sku: "VAS", track_inventory: true,
    stock_on_hand: 100, reserved_quantity: 0, available_quantity: 100,
    low_stock_threshold: otherNeedsReview ? 150 : 10, is_low_stock: otherNeedsReview,
  }];
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: {
    authenticated: true,
    user: { id: "user-1", email: "test@example.test", tenant_id: "tenant-1", role },
    tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
  } }));
  await page.route("**/api/v1/settings/business-profile", (route) => route.fulfill({ json: {
    tenant_id: "tenant-1", public_name: "Negocio de prueba", timezone: "America/Mexico_City",
    locale: "es-MX", currency: "MXN", support_email: null, support_phone: null,
  } }));
  await page.route("**/api/v1/reports/business-story**", (route) => route.fulfill({ json: makeStory() }));
  await page.route("**/api/v1/reports/sales-by-hour**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/inventory/stock", (route) => route.fulfill({ json: stock() }));
  await page.route("**/api/v1/inventory/low-stock", (route) => route.fulfill({ json: stock().filter((item) => item.is_low_stock) }));
  await page.route("**/api/v1/inventory/velocity", (route) => route.fulfill({ json: [{
    product_id: "p1", product_name: "Leche", stock_on_hand: onHand,
    units_per_day_7d: "2.00", days_until_out: String(onHand / 2),
  }, {
    product_id: "p2", product_name: "Vasos", stock_on_hand: 100,
    units_per_day_7d: "1.00", days_until_out: "100",
  }] }));
  await page.route("**/api/v1/inventory/products/p1/adjustments", async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    onHand += body.quantity_delta;
    await route.fulfill({ status: 201, json: {
      id: "movement-1", product_id: "p1", movement_type: "adjustment",
      quantity_delta: body.quantity_delta, stock_on_hand: onHand,
      reason: body.reason, reason_code: body.reason_code,
    } });
  });
  return { writes };
}

for (const width of [1280, 390, 320]) {
  test(`restock decision opens the exact product and recalculates after actual receipt at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const { writes } = await mockBusiness(page);
    await page.goto("/reports");
    const plan = page.getByTestId("restock-plan");
    await expect(plan.getByText("Considera reponer 8 unidades", { exact: true })).toBeVisible();
    await expect(plan.getByText("10 en existencia · 4 reservadas · 6 disponibles")).toBeVisible();
    await expect(plan.getByText("¿Cuántos días quieres cubrir?")).toBeVisible();
    for (const label of ["3 días", "7 días", "14 días", "Actualizar datos"]) {
      const bounds = await plan.getByRole("button", { name: label, exact: true }).boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const axe = (window as typeof window & {
        axe: { run: (selector: string, options: object) => Promise<AxeResults> };
      }).axe;
      const result = await axe.run('[data-testid="restock-plan"]', {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      });
      return result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
    });
    expect(violations).toEqual([]);
    await testInfo.attach(`plan-${width}px`, { body: await page.screenshot(), contentType: "image/png" });
    const calculation = plan.getByRole("button", { name: "Cómo calculamos la sugerencia" });
    await calculation.focus();
    await page.keyboard.press("Enter");
    await expect(calculation).toHaveAttribute("aria-expanded", "true");
    await expect(plan.getByRole("region", { name: "Cómo calculamos la sugerencia" })).toContainText("Para 7 días: ≈14 unidades");
    await page.keyboard.press("Enter");
    await expect(calculation).toHaveAttribute("aria-expanded", "false");
    await plan.getByRole("button", { name: "14 días" }).click();
    await expect(plan.getByText("Considera reponer 22 unidades", { exact: true })).toBeVisible();
    await plan.getByRole("button", { name: "7 días" }).click();
    await plan.getByRole("link", { name: "Revisar inventario de Leche" }).click();
    await expect(page).toHaveURL(/\/inventory\?product=p1$/);
    await expect(page.getByRole("heading", { name: "Leche", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vasos", exact: true })).not.toBeVisible();
    expect(writes).toEqual([]);
    await page.getByRole("button", { name: /^ajustar$/i }).click();
    await page.getByLabel(/cambio de cantidad/i).fill("8");
    await page.getByLabel(/^motivo$/i).fill("Recibí 8 unidades del proveedor");
    await page.getByRole("button", { name: /guardar/i }).click();
    await expect(page.getByText("Stock ajustado.", { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ quantity_delta: 8, reason: "Recibí 8 unidades del proveedor" });
    await page.getByRole("link", { name: "Volver a Análisis" }).click();
    await expect(plan.getByText(/Los productos con datos suficientes cubren 7 días/)).toBeVisible();
    await expect(plan.getByText("Considera reponer 8 unidades", { exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("unknown product focus shows an honest notice and can be cleared without any mutation", async ({ page }) => {
  const { writes } = await mockBusiness(page, "owner", true);
  await page.goto("/inventory?product=other-tenant-product");
  await expect(page.getByText(/Este producto ya no está disponible en el inventario de tu negocio/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leche", exact: true })).not.toBeVisible();
  await expect(page.getByText("Vasos", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Ver todo el inventario" }).click();
  await expect(page.getByRole("heading", { name: "Leche", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vasos", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
