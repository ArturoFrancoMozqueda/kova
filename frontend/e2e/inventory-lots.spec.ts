import { expect, test } from "./fixtures";

for (const width of [390, 1280]) {
  test(`lotes conserva existencias y confirma reglas de fechas a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
      authenticated: true, tenant_id: "tenant-1", tenant_name: "Café de prueba",
      user: { id: "user-1", email: "qa@example.com", tenant_id: "tenant-1", role: "owner", email_verified: true },
    } }));
    const stock = { product_id: "product-1", product_name: "Café 250 g", sku: "CAF", track_inventory: true, track_lots: true,
      stock_on_hand: 8, reserved_quantity: 0, available_quantity: 8, low_stock_threshold: 2, is_low_stock: false };
    await page.route("**/api/v1/inventory/stock", route => route.fulfill({ json: [stock] }));
    await page.route("**/api/v1/inventory/low-stock", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/inventory/velocity", route => route.fulfill({ json: [] }));
    let lots = [{ id: "unknown", product_id: "product-1", code: "Lote y fecha desconocidos", is_unknown: true, manufactured_on: null as string | null,
      rotation_on: null as string | null, expires_on: null as string | null, rotation_label: "consumo_preferente", stock_on_hand: 8,
      reserved_quantity: 0, available_quantity: 8, stock_conflict: false, date_status: "sin_fecha" }];
    await page.route("**/api/v1/inventory/products/product-1/lots/suggestions?*", route => route.fulfill({ json: {
      manufactured_on: "2026-10-08", rotation_on: "2026-10-22", expires_on: "2026-11-07", rotation_label: "consumo_preferente",
    } }));
    await page.route("**/api/v1/inventory/products/product-1/lots", async route => {
      if (route.request().method() === "GET") { await route.fulfill({ json: lots }); return; }
      const body = route.request().postDataJSON() as { code: string; manufactured_on: string; rotation_on: string; expires_on: string };
      expect(body).toEqual({ code: "Tostado 8 octubre", manufactured_on: "2026-10-08", rotation_on: "2026-10-22", expires_on: "2026-11-07" });
      const created = { ...lots[0], ...body, id: "new-lot", is_unknown: false, stock_on_hand: 0, available_quantity: 0, date_status: "vigente" };
      lots = [...lots, created];
      await route.fulfill({ status: 201, json: created });
    });
    await page.goto("/inventory");
    await page.getByText("Lotes y fechas", { exact: true }).click();
    await expect(page.getByText("8 físicas · 0 reservadas · 8 disponibles")).toBeVisible();
    await page.getByRole("button", { name: "Nuevo lote", exact: true }).click();
    await page.getByLabel("Identificador del lote").fill("Tostado 8 octubre");
    await page.getByLabel("Elaboración", { exact: true }).fill("2026-10-08");
    await expect(page.getByLabel("Caducidad", { exact: true })).toHaveValue("2026-11-07");
    await page.getByRole("button", { name: "Confirmar fechas y guardar" }).click();
    await expect(page.locator("p").filter({ hasText: /^Tostado 8 octubre$/ })).toBeVisible();
    await expect(page.getByText("0 físicas · 0 reservadas · 0 disponibles")).toBeVisible();
    await expect(page.getByText("8 físicas · 0 reservadas · 8 disponibles")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
