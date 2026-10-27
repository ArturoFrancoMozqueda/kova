import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

const customer = { id: "11111111-1111-4111-8111-111111111111", name: "Ana del Patio", is_active: true };
const code = "KV-0123-4567-89AB-CDEF";
const product = { id: "product-1", tenant_id: "tenant-1", category_id: null, name: "Café de especialidad", sku: "CAFE-1", price_amount: "100.00", track_inventory: false, is_active: true, modifier_groups: [] };

for (const width of [390, 1440]) {
  test(`member code selects one customer without losing the cart and locks pending checkout at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await markFirstUseToursSeen(page);
    const lookups: { body: unknown; headers: Record<string, string> }[] = [];
    const checkouts: unknown[] = [];
    let offlineWrites = 0;
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: true, tenant_id: "tenant-1", tenant_name: "Café del Patio", user: { id: "cashier-1", email: "cashier@example.invalid", role: "cashier", tenant_id: "tenant-1" }, feature_flags: { customer_orders: true } } }));
    await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: { subscription: { status: "active" }, access: { allowed: true, reason: "active", trialing: false } } }));
    await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: [product] }));
    await page.route("**/api/v1/catalog/categories", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/inventory/stock", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [customer] }));
    await page.route("**/api/v1/shifts/current", route => route.fulfill({ json: { id: "shift-1", status: "open", opening_cash_amount: "100.00" } }));
    await page.route("**/api/v1/loyalty/members/resolve", route => {
      expect(route.request().method()).toBe("POST");
      lookups.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
      return route.fulfill({ json: { customer } });
    });
    await page.route("**/api/v1/loyalty/rewards/offer?**", route => route.fulfill({ json: {
      customer_id: customer.id, balance: 30, adjustments_pending: false,
      reward: { id: "reward-1", version: 1, enabled: true, title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" },
    } }));
    await page.route("**/api/v1/loyalty/rewards/checkout", route => {
      checkouts.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { detail: "Consulta el resultado guardado antes de volver a cobrar." } });
    });
    await page.route("**/api/v1/sync/offline-sales", route => { offlineWrites++; return route.fulfill({ status: 503, json: {} }); });
    await page.goto("/register");
    await page.getByRole("button", { name: "Agregar Café de especialidad" }).click();
    const lookup = page.getByRole("region", { name: "Identificar tarjeta de lealtad" });
    await lookup.getByRole("button", { name: "Identificar tarjeta" }).click();
    await expect(lookup.getByLabel("Número de tarjeta")).toBeFocused();
    await lookup.getByLabel("Número de tarjeta").fill(code);
    await lookup.getByLabel("Número de tarjeta").press("Enter");
    await expect(lookup.getByRole("button", { name: "Usar cliente" })).toBeFocused();
    expect(lookups).toHaveLength(1);
    expect(lookups[0].body).toEqual({ code });
    expect(lookups[0].headers).toMatchObject({ "x-kova-expected-tenant": "tenant-1", "x-kova-expected-user": "cashier-1", "x-kova-branch": "tenant-1" });
    expect(checkouts).toHaveLength(0);
    await expect(page.getByRole("region", { name: "Cliente de esta venta" })).toHaveCount(0);
    await lookup.getByRole("button", { name: "Usar cliente" }).click();
    const selected = page.getByRole("region", { name: "Cliente de esta venta" });
    await expect(selected).toContainText("Ana del Patio");
    await expect(page.getByText("Cliente, descuento e impuesto", { exact: true }).locator("..")).not.toHaveAttribute("open");
    await selected.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`member-selected-${width}.png`), animations: "disabled", fullPage: true });
    if (width === 390) {
      await page.getByRole("button", { name: "Ocultar resumen de venta" }).click();
      await expect(page.getByRole("button", { name: "Mostrar resumen de venta" })).toContainText("Ana del Patio");
      await page.getByRole("button", { name: "Mostrar resumen de venta" }).click();
    }
    await selected.getByRole("button", { name: "Cambiar cliente de la venta" }).click();
    await expect(page.getByLabel("Buscar cliente")).toBeFocused();
    await selected.getByRole("button", { name: "Quitar cliente de la venta" }).click();
    await expect(selected).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Quitar Café de especialidad" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Cobrar$/ })).toContainText("$100.00");
    await lookup.getByRole("button", { name: "Identificar tarjeta" }).click();
    await lookup.getByLabel("Número de tarjeta").fill(code);
    await lookup.getByRole("button", { name: "Buscar tarjeta" }).click();
    await lookup.getByRole("button", { name: "Usar cliente" }).click();
    await context.setOffline(true);
    await expect(lookup.getByRole("button", { name: "Identificar tarjeta" })).toBeDisabled();
    await expect(page.getByText("Conéctate para identificar una tarjeta de lealtad.")).toBeVisible();
    await expect(selected).toContainText("Ana del Patio");
    await context.setOffline(false);
    const reward = page.getByRole("region", { name: "Recompensa de esta venta" });
    await reward.getByLabel("El cliente confirma usar sus puntos").check();
    await reward.getByRole("button", { name: "Aplicar a esta venta" }).click();
    await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Cobrar$/ })).toHaveCSS("opacity", "1");
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`member-checkout-${width}.png`), animations: "disabled", fullPage: true });
    await page.getByRole("button", { name: /^Cobrar$/ }).click();
    await expect(page.getByRole("region", { name: "Confirmar venta con recompensa" })).toBeFocused();
    await expect(lookup.getByRole("button", { name: "Identificar tarjeta" })).toBeDisabled();
    await expect(selected.getByRole("button", { name: "Cambiar cliente de la venta" })).toBeDisabled();
    await expect(selected.getByRole("button", { name: "Quitar cliente de la venta" })).toBeDisabled();
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toMatchObject({ confirmed: true, order: { customer_id: customer.id, payments: [{ method: "manual_card", amount: "80.00" }] } });
    expect(offlineWrites).toBe(0);
  });
}
