import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

for (const width of [390, 1440]) {
  test(`reposición conserva la compra exacta hasta la recepción explícita a ${width}px`, async ({ page }, testInfo) => {
    await markFirstUseToursSeen(page);
    await page.setViewportSize({ width, height: 1000 });
    const supplier = { id: "supplier-1", name: "Molino registrado", contact: null, is_active: true };
    const product = { id: "product-1", tenant_id: "tenant-1", category_id: null, name: "Harina", description: null, sku: null, price_amount: "45.00", cost_price: "12.50", track_inventory: true, track_lots: false, low_stock_threshold: 5, image_url: null, image_position_x: 50, image_position_y: 50, image_zoom: 1, is_active: true, modifier_groups: [] };
    const purchase = { id: "purchase-created-1", branch_id: "branch-1", supplier_id: supplier.id, supplier_name: supplier.name, notes: null, status: "pending", created_at: "2026-10-25T12:00:00Z", items: [{ id: "item-1", product_id: product.id, product_name: product.name, quantity: 4, received_quantity: 0, unit_cost: "12.50" }] };
    const writes: { path: string; body: unknown }[] = [];
    let created = false;
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: true, user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" }, tenant_id: "tenant-1", tenant_name: "Negocio de prueba" } }));
    await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: { subscription: { status: "active" }, access: { allowed: true, reason: "active", trialing: false } } }));
    await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: [product] }));
    await page.route("**/api/v1/purchasing/suppliers", route => route.fulfill({ json: [supplier] }));
    await page.route("**/api/v1/replenishment", route => route.fulfill({ json: created ? [] : [{ product_id: product.id, product_name: product.name, available_quantity: 2, reserved_quantity: 1, incoming_quantity: 0, low_stock_threshold: 5, suggested_quantity: 4, unit_cost: "12.50", evidence_version: "evidence-1" }] }));
    await page.route("**/api/v1/replenishment/approve-purchase", async route => {
      writes.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      created = true;
      await route.fulfill({ json: purchase, status: 201 });
    });
    await page.route("**/api/v1/purchasing/orders?**", route => route.fulfill({ json: created ? [purchase] : [] }));
    await page.route("**/api/v1/purchasing/orders/purchase-created-1/receive", async route => {
      const body = route.request().postDataJSON();
      writes.push({ path: new URL(route.request().url()).pathname, body });
      purchase.status = "partial";
      purchase.items[0].received_quantity = 2;
      await route.fulfill({ json: purchase });
    });

    await page.goto("/replenishment");
    await page.getByLabel("Proveedor", { exact: true }).selectOption(supplier.id);
    await page.getByRole("button", { name: "Revisar compra", exact: true }).click();
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "Confirmar y crear compra pendiente", exact: true }).click();
    const next = page.getByRole("link", { name: "Revisar compra creada", exact: true });
    await expect(next).toHaveAttribute("href", "/purchasing?purchase_id=purchase-created-1");
    await next.click();
    const record = page.getByRole("region", { name: /^Compra de Molino registrado ·/ });
    await expect(record).toBeFocused();
    await expect(record).toContainText("0 de 4 recibidas");
    expect(writes).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Confirmar recepción", exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(/\/purchasing\?purchase_id=purchase-created-1$/);
    await expect(record).toBeFocused();
    expect(writes).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Preparar compra", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Nuevo proveedor", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Crear compra pendiente", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Preparar compra", exact: true }).click();
    const setup = page.getByRole("region", { name: "Preparar compra pendiente", exact: true });
    await expect(setup).toBeFocused();
    expect(await record.evaluate((node, selector) => Boolean(node.compareDocumentPosition(document.querySelector(selector)!) & Node.DOCUMENT_POSITION_FOLLOWING), '[aria-label="Preparar compra pendiente"]')).toBe(true);
    await page.getByLabel("Referencia o notas (opcional)").fill("Borrador conservado");
    await page.getByRole("button", { name: "Preparar compra", exact: true }).click();
    await page.getByRole("button", { name: "Preparar compra", exact: true }).click();
    await expect(page.getByLabel("Referencia o notas (opcional)")).toHaveValue("Borrador conservado");
    await page.getByRole("button", { name: "Preparar compra", exact: true }).click();
    expect(writes).toHaveLength(1);
    await record.getByRole("button", { name: "Recibir mercancía", exact: true }).click();
    await page.getByLabel("Harina · pendientes 4", { exact: true }).fill("2");
    await expect(page.getByRole("checkbox", { name: /Actualizar el costo del catálogo/ })).not.toBeChecked();
    expect(writes).toHaveLength(1);
    await page.getByRole("button", { name: "Confirmar recepción", exact: true }).click();
    await expect(record).toContainText("2 de 4 recibidas");
    expect(writes).toEqual([
      { path: "/api/v1/replenishment/approve-purchase", body: { supplier_id: supplier.id, items: [{ product_id: product.id, quantity: 4, unit_cost: "12.50", evidence_version: "evidence-1" }] } },
      { path: "/api/v1/purchasing/orders/purchase-created-1/receive", body: { items: [{ item_id: "item-1", quantity: 2 }], update_catalog_cost: false } },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`purchase-continuity-${width}.png`), fullPage: true });
  });
}
