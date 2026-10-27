import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

const customer = { id: "customer-1", name: "Ana", phone: null, email: null, is_active: true, created_at: "2026-10-26T12:00:00Z" };
const product = { id: "product-1", tenant_id: "tenant-1", category_id: null, name: "Café de especialidad", description: null, sku: "CAFE-1", price_amount: "100.00", track_inventory: false, low_stock_threshold: null, is_active: true, modifier_groups: [] };
async function check(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
  expect(violations).toEqual([]);
}
async function storedCount(page: Page, name: string, store: string) {
  return page.evaluate(({ name, store }) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(store)) { database.close(); resolve(0); return; }
      const read = database.transaction(store, "readonly").objectStore(store).count();
      read.onsuccess = () => { database.close(); resolve(read.result); };
      read.onerror = () => { database.close(); reject(read.error); };
    };
  }), { name, store });
}

for (const width of [390, 1440]) {
  test(`configured reward reduces a real sale and recovers one uncertain checkout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await markFirstUseToursSeen(page);
    let role = "owner";
    let authenticated = true;
    let reward: { id: string; version: number; enabled: boolean; title: string; points_cost: number; discount_amount: string } | null = null;
    let balance = 30;
    let queueWrites = 0;
    let ledgerDebits = 0;
    const writes: { key: string; body: unknown }[] = [];
    const processed = new Set<string>();
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: authenticated ? { authenticated: true, tenant_id: "tenant-1", tenant_name: "Café del Patio", user: { id: role === "owner" ? "owner-1" : "cashier-1", email: `${role}@example.invalid`, role, tenant_id: "tenant-1" }, feature_flags: { customer_orders: true, margin_reports: false } } : { authenticated: false } }));
    await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: { subscription: { status: "active" }, access: { allowed: true, reason: "active", trialing: false } } }));
    await page.route("**/api/v1/loyalty?**", route => route.fulfill({ json: { policy: { enabled: true, spend_amount: "100.00", points_per_step: 5, version: 1 }, accounts: [], accounts_has_more: false } }));
    await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [customer] }));
    await page.route("**/api/v1/loyalty/rewards", route => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ expected_version: 0, enabled: true, title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" });
        expect(route.request().headers()["x-kova-expected-user"]).toBe("owner-1");
        reward = { id: "reward-1", version: 1, enabled: true, title: body.title, points_cost: body.points_cost, discount_amount: body.discount_amount };
      }
      return route.fulfill({ json: reward });
    });
    await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: [product] }));
    await page.route("**/api/v1/catalog/categories", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/inventory/stock", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/shifts/current", route => route.fulfill({ json: { id: "shift-1", tenant_id: "tenant-1", status: "open", opening_cash_amount: "100.00", expected_cash_amount: "100.00" } }));
    await page.route("**/api/v1/settings/receipt", route => route.fulfill({ json: { tenant_id: "tenant-1", receipt_business_name: "Café del Patio", footer: null, tax_contact_text: null, logo_url: null, paper_width_mm: 80 } }));
    await page.route("**/api/v1/loyalty/rewards/offer?**", route => route.fulfill({ json: { customer_id: customer.id, balance, adjustments_pending: false, reward } }));
    const sale = { id: "sale-reward-1", tenant_id: "tenant-1", branch_id: "tenant-1", customer_id: customer.id, status: "completed", subtotal_amount: "100.00", discount_amount: "20.00", tax_rate: "0.00", tax_amount: "0.00", total_amount: "80.00", items: [{ id: "item-1", product_id: product.id, product_name: product.name, quantity: 1, unit_price_amount: "100.00", line_total_amount: "80.00", modifiers: [] }], payments: [{ method: "manual_card", amount_amount: "80.00", amount_tendered_amount: null, change_due_amount: "0.00", reference: null }], loyalty_reward: { id: "reward-1", title: "Gracias por volver", points_cost: 20, discount_amount: "20.00" } };
    await page.route("**/api/v1/loyalty/rewards/checkout", route => {
      const key = route.request().headers()["idempotency-key"];
      const body = route.request().postDataJSON();
      expect(key).toBeTruthy();
      expect(body).toMatchObject({ reward_id: "reward-1", reward_version: 1, expected_balance: 30, confirmed: true, order: { customer_id: customer.id, discount_amount: "0.00", tax_rate: "0.00", items: [{ product_id: product.id, quantity: 1 }], payments: [{ method: "manual_card", amount: "80.00" }] } });
      expect(body.order.items[0]).not.toHaveProperty("unit_price_amount");
      writes.push({ key, body });
      if (!processed.has(key)) { processed.add(key); balance -= 20; ledgerDebits += 1; }
      return route.fulfill(writes.length === 1 ? { status: 503, json: { detail: "No pudimos confirmar el resultado. Consulta la referencia guardada." } } : { json: sale });
    });
    await page.route("**/api/v1/orders/sale-reward-1/receipt", route => route.fulfill({ json: { ...sale, order_id: sale.id, receipt_number: "V-001", tenant_name: "Café del Patio", created_at: "2026-10-26T12:00:00Z", refunds: [], void: null, total_tendered: "80.00", total_change: "0.00" } }));
    await page.route("**/api/v1/sync/offline-sales", route => { queueWrites += 1; return route.fulfill({ status: 503, json: {} }); });
    await page.route("**/api/v1/public/loyalty/cards", route => route.fulfill({ json: { business_name: "Café del Patio", branch_name: "Centro", balance, adjustments_pending: false, policy: { enabled: true, spend_amount: "100.00", points_per_step: 5 }, expires_at: "2099-11-26T12:00:00Z", catalog_path: "/catalogo/cafe-del-patio", reward } }));

    await page.goto("/loyalty");
    await page.getByRole("button", { name: "Definir recompensa" }).click();
    await expect(page.getByLabel("Nombre de la recompensa")).toHaveValue("");
    await expect(page.getByLabel("Permitir nuevos canjes en caja")).not.toBeChecked();
    await page.getByLabel("Nombre de la recompensa").fill("Gracias por volver");
    await page.getByLabel("Puntos para canjear").fill("20");
    await page.getByLabel("Descuento en MXN").fill("20.00");
    await page.getByLabel("Permitir nuevos canjes en caja").check();
    await page.getByRole("button", { name: "Guardar recompensa" }).click();
    await expect(page.getByRole("region", { name: "Recompensa en caja", exact: true }).getByRole("status")).toContainText("Recompensa guardada");
    await check(page);

    role = "cashier";
    await page.goto("/register");
    await page.getByRole("button", { name: "Agregar Café de especialidad" }).click();
    await page.getByText("Cliente, descuento e impuesto", { exact: true }).click();
    await page.getByLabel("Cliente de la venta", { exact: true }).selectOption(customer.id);
    const picker = page.getByRole("region", { name: "Recompensa de esta venta" });
    await expect(picker.getByRole("button", { name: "Aplicar a esta venta" })).toBeDisabled();
    await picker.getByLabel("El cliente confirma usar sus puntos").check();
    await picker.getByRole("button", { name: "Aplicar a esta venta" }).click();
    await expect(page.getByLabel("Descuento de la venta (MXN)")).toBeDisabled();
    await expect(page.getByText("Subtotal", { exact: true }).locator("..")).toContainText("$100.00");
    await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Cobrar$/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Cobrar$/ })).toContainText("$80.00");
    await expect(page.getByRole("button", { name: /^Cobrar$/ })).toHaveCSS("opacity", "1");
    await check(page);
    await page.screenshot({ path: testInfo.outputPath(`reward-preview-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: /^Cobrar$/ }).click();
    const recovery = page.getByRole("region", { name: "Confirmar venta con recompensa" });
    await expect(recovery).toContainText("Hay una venta con recompensa por confirmar");
    await expect(recovery).toBeInViewport({ ratio: 0.9 });
    await expect(recovery).toBeFocused();
    await recovery.getByRole("button", { name: "Consultar resultado de la venta" }).click({ trial: true });
    expect(writes).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Agregar Café de especialidad" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`reward-uncertain-${width}.png`), fullPage: true });
    expect(await storedCount(page, "kova_reward_recovery", "pending")).toBe(1);
    expect(await storedCount(page, "pos_offline", "offline_sales")).toBe(0);
    expect(queueWrites).toBe(0); expect(ledgerDebits).toBe(1);
    await page.reload();
    await expect(recovery).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar Café de especialidad" })).toBeDisabled();
    await recovery.getByRole("button", { name: "Consultar resultado de la venta" }).click();
    await expect(page.getByRole("status")).toContainText("Venta completada");
    await expect(page.getByText("Gracias por volver · 20 puntos canjeados", { exact: true }).filter({ visible: true })).toHaveCount(1);
    expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
    expect(await storedCount(page, "kova_reward_recovery", "pending")).toBe(0);
    expect(await storedCount(page, "pos_offline", "offline_sales")).toBe(0);
    expect(queueWrites).toBe(0); expect(ledgerDebits).toBe(1); expect(balance).toBe(10);

    authenticated = false;
    await page.goto("/lealtad#reward-customer-card");
    await expect(page.getByLabel("Tus puntos")).toHaveText("10");
    const goal = page.getByRole("region", { name: "Tu próxima recompensa" });
    await expect(goal).toContainText("Gracias por volver");
    await expect(goal).toContainText("Te faltan 10 puntos.");
    await expect(goal.getByRole("progressbar", { name: "Progreso de tu recompensa" })).toHaveAttribute("max", "20");
    await expect(goal.getByRole("progressbar", { name: "Progreso de tu recompensa" })).toHaveAttribute("value", "10");
    await check(page);
    await page.screenshot({ path: testInfo.outputPath(`reward-card-${width}.png`), fullPage: true });
  });
}
