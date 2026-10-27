import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

const publishedMenu = { title: "Café del Patio", description: "Café, pan recién hecho y algo rico para compartir.", whatsapp_phone: null, checkout_available: false, products: [{ id: "bread", name: "Pan de nuez", description: "Horneado con nuez y canela.", price_amount: "45.00", availability: "available" }] };
async function check(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
  expect(violations).toEqual([]);
}

for (const width of [320, 390, 768, 1440]) {
  test(`menu intake is reviewed once and continues through preparation to public tracking at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await markFirstUseToursSeen(page);
    let owner = false;
    let submitted = false;
    let accepted = false;
    let trackingStatus = "pending_review";
    const mutations: { url: string; body: unknown }[] = [];
    const customer = { id: "customer-1", name: "Cliente registrado", email: null, phone: null, is_active: true, created_at: "2026-10-26T12:00:00Z" };
    const request = { id: "request-1", name: "Ana", contact: "ana@example.invalid", message: "Solicitud de pedido del menú", product_ids: ["bread"], order_lines: [{ product_id: "bread", product_name: "Pan de nuez", quantity: 1, unit_price_amount: "45.00", line_total_amount: "45.00" }], origin: "remote", customer_id: null, opportunity_id: null, customer_order_id: null as string | null, status: "new", version: 1, created_at: "2026-10-26T12:00:00Z" };
    const order = { id: "order-1", tenant_id: "tenant-1", folio: "PED-001", status: "new", payment_status: "unpaid", fulfillment_type: "pickup", source_channel: "other", customer_id: customer.id, customer_name: customer.name, customer_phone: null, delivery_address: null, delivery_reference: null, promised_at: null, note: "Pedido recibido desde el menú digital", subtotal_amount: "45.00", total_amount: "45.00", sale_order_id: null, version: 1, stock_conflict: false, items: [{ id: "item-1", product_id: "bread", product_name: "Pan de nuez", quantity: 1, unit_price_amount: "45.00", line_total_amount: "45.00", note: null, modifier_option_ids: [], modifiers: [] }], confirmed_at: null, ready_at: null, fulfilled_at: null, cancelled_at: null, cancellation_reason: null, cancellation_note: null, created_at: "2026-10-26T12:00:00Z", updated_at: "2026-10-26T12:00:00Z" };
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: owner ? { authenticated: true, tenant_id: "tenant-1", tenant_name: "Café del Patio", user: { id: "owner-1", email: "owner@example.invalid", role: "owner", tenant_id: "tenant-1" }, feature_flags: { customer_orders: true, margin_reports: false } } : { authenticated: false } }));
    await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: { plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" }, subscription: null, access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null, blocked_at: null, recovery_path: "/settings/billing" } } }));
    await page.route("**/api/v1/public/catalog/order-menu", route => route.fulfill({ json: publishedMenu }));
    await page.route("**/api/v1/public/catalog/order-menu/requests", route => {
      const body = route.request().postDataJSON();
      expect(body.order_lines).toEqual([{ product_id: "bread", quantity: 1 }]);
      expect(body.origin).toBe("remote");
      expect(route.request().headers().cookie).toBeUndefined();
      submitted = true;
      return route.fulfill({ status: 201, json: { receipt_id: request.id, status: "received", tracking_path: "/seguimiento#order-test-capability", tracking_expires_at: "2099-11-26T12:00:00Z" } });
    });
    await page.route("**/api/v1/public/order-tracking", route => {
      expect(route.request().postDataJSON()).toEqual({ token: "order-test-capability" });
      expect(route.request().headers().referer).toBeUndefined();
      expect(route.request().headers().cookie).toBeUndefined();
      return route.fulfill({ json: { business_name: publishedMenu.title, branch_name: "Centro", status: trackingStatus, folio: accepted ? order.folio : null, total_amount: accepted ? order.total_amount : null, items: [{ product_name: "Pan de nuez", quantity: 1 }], catalog_path: "/catalogo/order-menu", updated_at: "2026-10-26T12:00:00Z", expires_at: "2099-11-26T12:00:00Z" } });
    });
    await page.route("**/api/v1/crm/requests?**", route => route.fulfill({ json: { requests: submitted ? [request] : [], has_more: false } }));
    await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [customer] }));
    await page.route("**/api/v1/crm/requests/request-1/order-preview", route => route.fulfill({ json: { request_id: request.id, version: request.version, items: [{ ...request.order_lines[0], available_quantity: 8 }], total_amount: "45.00", can_accept: !accepted, issues: [], preview_fingerprint: "reviewed-prices", customer_order_id: request.customer_order_id } }));
    await page.route("**/api/v1/crm/requests/request-1/accept-order", route => {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ customer_id: customer.id, expected_version: 1, preview_fingerprint: "reviewed-prices", confirmed: true });
      mutations.push({ url: new URL(route.request().url()).pathname, body });
      accepted = true; trackingStatus = "accepted"; request.status = "accepted"; request.customer_order_id = order.id; request.version = 2;
      return route.fulfill({ status: 201, json: { request, customer_order: order } });
    });
    await page.route("**/api/v1/customer-orders/order-1", route => route.fulfill({ json: order }));
    await page.route("**/api/v1/customer-orders/order-1/confirm", route => {
      mutations.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      order.status = "confirmed"; order.version += 1; trackingStatus = "confirmed";
      return route.fulfill({ json: order });
    });
    await page.route("**/api/v1/customer-orders/order-1/status", route => {
      const body = route.request().postDataJSON();
      mutations.push({ url: new URL(route.request().url()).pathname, body });
      order.status = body.status; order.version += 1; trackingStatus = body.status;
      return route.fulfill({ json: order });
    });

    await page.goto("/catalogo/order-menu");
    await page.getByRole("button", { name: "Agregar Pan de nuez al pedido" }).click();
    if (width < 1024) await page.getByRole("button", { name: /Ver mi pedido/ }).click();
    await page.getByLabel("Tu nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Teléfono o correo para responder").fill("ana@example.invalid");
    await page.getByRole("button", { name: "Enviar solicitud de pedido" }).click();
    await expect(page).toHaveURL(/\/seguimiento#order-test-capability$/);
    await expect(page.getByRole("region", { name: "Estado de tu solicitud", exact: true }).getByRole("status")).toContainText("Solicitud recibida");
    await expect(page.getByText("Total registrado", { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    await expect(page.getByRole("button", { name: "Actualizar ahora" })).toHaveCount(0);
    await check(page);

    owner = true;
    await page.goto("/commercial-requests");
    await page.getByRole("button", { name: "Revisar pedido de Ana", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Revisar pedido de Ana" });
    await expect(dialog.getByText("1 × Pan de nuez")).toBeVisible();
    const create = dialog.getByRole("button", { name: "Crear pedido para confirmar" });
    await expect(create).toBeDisabled();
    await dialog.getByLabel("Vincular con cliente registrado").selectOption(customer.id);
    await dialog.getByLabel(/Revisé productos, cantidades, precios y cliente/).check();
    await check(page);
    await create.click();
    const created = page.getByRole("dialog", { name: "Pedido creado" });
    await expect(created.getByRole("status")).toContainText("Confirma el pedido para reservar sus productos");
    await created.getByRole("link", { name: "Abrir pedido" }).click();
    await expect(page).toHaveURL(/\/pedidos\/order-1$/);
    await page.getByRole("button", { name: "Confirmar y reservar", exact: true }).click();
    await page.getByRole("button", { name: "Marcar en preparación", exact: true }).click();
    await page.getByRole("button", { name: "Marcar listo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Marcar entregado", exact: true })).toBeDisabled();
    await expect(page.getByText("El pedido está listo. Registra el cobro en Caja para poder marcarlo como entregado.")).toBeVisible();
    expect(mutations).toHaveLength(4);

    owner = false;
    await page.goto("/seguimiento#order-test-capability");
    await expect(page.getByRole("status")).toContainText("Tu pedido está listo");
    await expect(page.getByText(/Acuerda el pago directamente con el negocio/)).toBeVisible();
    await check(page);
    await page.screenshot({ path: testInfo.outputPath(`tracking-ready-${width}.png`), fullPage: true });
  });
}

test("tracking handles expired access, refresh and keyboard disclosure without personal-data entry", async ({ page }) => {
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { authenticated: false } }));
  let available = false;
  await page.route("**/api/v1/public/order-tracking", route => route.fulfill(!available ? { status: 404, json: {} } : { json: { business_name: "Café del Patio", branch_name: "Centro", status: "cancelled", folio: "PED-002", total_amount: "45.00", items: [{ product_name: "Pan de nuez", quantity: 1 }], catalog_path: "/catalogo/order-menu", updated_at: "2026-10-26T12:00:00Z", expires_at: "2099-11-26T12:00:00Z" } }));
  await page.goto("/seguimiento#expired-test");
  await expect(page.getByRole("alert")).toContainText("Este enlace ya no está disponible");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  available = true;
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByRole("status")).toContainText("Pedido cancelado");
  const summary = page.locator("summary").filter({ hasText: "Acerca del seguimiento" });
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText(/El enlace vence el/)).toBeVisible();
  await check(page);
});
