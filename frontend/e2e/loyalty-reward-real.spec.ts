import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";

async function write(page: Page, path: string, body: unknown, key = crypto.randomUUID()) {
  return page.evaluate(async ({ path, body, key }) => {
    const csrf = document.cookie.split("; ").find(item => item.startsWith("csrf_token="))?.slice("csrf_token=".length);
    if (!csrf) throw new Error("La operación local requiere el CSRF real del navegador.");
    const response = await fetch(`/api/v1${path}`, {
      method: "POST", credentials: "include", headers: {
        "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": key,
      }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Operación local ${path}: ${response.status}`);
    return response.json();
  }, { path, body, key });
}

async function storedCount(page: Page, name: string, store: string) {
  return page.evaluate(({ name, store }) => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open(name);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains(store)) { database.close(); resolve(0); return; }
      const request = database.transaction(store, "readonly").objectStore(store).count();
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => { database.close(); reject(request.error); };
    };
  }), { name, store });
}

async function ordinarySales(page: Page) {
  return page.evaluate(() => new Promise<{ client_uuid: string; status: string; synced_order_id?: string }[]>((resolve, reject) => {
    const opening = indexedDB.open("pos_offline");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const request = database.transaction("offline_sales", "readonly").objectStore("offline_sales").getAll();
      request.onsuccess = () => { database.close(); resolve(request.result.map(({ client_uuid, status, synced_order_id }) => ({ client_uuid, status, synced_order_id }))); };
      request.onerror = () => { database.close(); reject(request.error); };
    };
  }));
}

test.describe("recompensa aplicada en Caja con API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y un stack efímero local");

  test("descuento, puntos, recibo y devolución conservan una sola operación real", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const postResponse = (path: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === "POST");
    const signupResponse = postResponse("/auth/signup");
    await createTenantThroughUi(page, "reward-real");
    const signup = await (await signupResponse).json();
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);

    // Only local master data and the accumulation rule are prepared by API.
    // Both financial sales and the configured reward are exercised through UI.
    const prepared = await page.evaluate(async (token: string) => {
      const csrf = document.cookie.split("; ").find(item => item.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf || !token) throw new Error("El setup local requiere CSRF y verificación de desarrollo.");
      const save = async (path: string, method: string, body: unknown) => {
        const response = await fetch(`/api/v1${path}`, {
          method, credentials: "include", headers: {
            "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID(),
          }, body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
        return response.json();
      };
      await save("/auth/verify", "POST", { token });
      await save("/settings/business-profile", "PUT", {
        public_name: "Café del Patio", support_email: null, support_phone: null,
        timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN",
      });
      const customer = await save("/customers", "POST", { name: "Cliente recompensa local", email: null, phone: null, is_active: true });
      const product = await save("/catalog/products", "POST", { name: "Café recompensa local", price_amount: "125.50", track_inventory: false, cost_price: "45.00" });
      await save("/loyalty/policy", "PUT", { expected_version: 0, enabled: true, spend_amount: "25.00", points_per_step: 2 });
      return { customerId: customer.id as string, productId: product.id as string };
    }, signup.dev_verification_token);

    const syncs: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/v1/sync/offline-sales" && request.method() === "POST") syncs.push(request.postData() ?? "");
    });
    await page.goto("/register");
    await page.getByRole("button", { name: "Agregar Café recompensa local", exact: true }).click();
    await page.getByText("Cliente, descuento e impuesto", { exact: true }).click();
    await page.getByLabel("Cliente de la venta", { exact: true }).selectOption(prepared.customerId);
    await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
    const initialSaleResponse = postResponse("/sync/offline-sales");
    await page.getByRole("button", { name: /^Cobrar$/ }).click();
    const initial = await initialSaleResponse;
    expect(initial.ok()).toBe(true);
    const synced = await initial.json();
    expect(synced.results).toHaveLength(1);
    expect(synced.results[0]).toMatchObject({ status: "synced", order: { customer_id: prepared.customerId, total_amount: "125.50" } });
    expect(syncs).toHaveLength(1);
    // Ordinary sales intentionally retain their synchronized local record.
    await expect.poll(() => ordinarySales(page)).toMatchObject([{ status: "synced", synced_order_id: synced.results[0].order.id }]);
    const baselineOrdinarySales = await ordinarySales(page);
    expect(baselineOrdinarySales).toHaveLength(1);

    await page.goto("/loyalty");
    const initialPointsResponse = postResponse("/loyalty/process");
    await page.getByRole("button", { name: "Actualizar movimientos de puntos", exact: true }).click();
    expect((await initialPointsResponse).ok()).toBe(true);
    await page.getByLabel("Cliente del programa", { exact: true }).selectOption(prepared.customerId);
    await expect(page.getByLabel("Saldo de puntos", { exact: true })).toHaveText("10 puntos");
    const settings = page.getByRole("region", { name: "Recompensa en caja", exact: true });
    await settings.getByRole("button", { name: "Definir recompensa", exact: true }).click();
    await settings.getByLabel("Nombre de la recompensa", { exact: true }).fill("Gracias por volver");
    await settings.getByLabel("Puntos para canjear", { exact: true }).fill("8");
    await settings.getByLabel("Descuento en MXN", { exact: true }).fill("25.00");
    await settings.getByLabel("Permitir nuevos canjes en caja", { exact: true }).check();
    const rewardPolicyResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/loyalty/rewards" && response.request().method() === "PUT");
    await settings.getByRole("button", { name: "Guardar recompensa", exact: true }).click();
    expect((await rewardPolicyResponse).ok()).toBe(true);
    await expect(settings.getByRole("status")).toContainText("Recompensa guardada");

    await page.goto("/register");
    await page.getByRole("button", { name: "Agregar Café recompensa local", exact: true }).click();
    await page.getByText("Cliente, descuento e impuesto", { exact: true }).click();
    await page.getByLabel("Cliente de la venta", { exact: true }).selectOption(prepared.customerId);
    const picker = page.getByRole("region", { name: "Recompensa de esta venta", exact: true });
    await expect(picker).toContainText("Saldo: 10 puntos");
    await picker.getByLabel("El cliente confirma usar sus puntos", { exact: true }).check();
    await picker.getByRole("button", { name: "Aplicar a esta venta", exact: true }).click();
    await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
    await expect(page.getByLabel("Descuento de la venta (MXN)", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Cobrar$/ })).toContainText("$100.50");
    const checkoutResponse = postResponse("/loyalty/rewards/checkout");
    await page.getByRole("button", { name: /^Cobrar$/ }).click();
    const checkedOut = await checkoutResponse;
    expect(checkedOut.ok()).toBe(true);
    const order = await checkedOut.json();
    expect(order).toMatchObject({ customer_id: prepared.customerId, subtotal_amount: "125.50", discount_amount: "25.00", tax_amount: "0.00", total_amount: "100.50",
      loyalty_reward: { title: "Gracias por volver", points_cost: 8, discount_amount: "25.00" }, payments: [{ method: "manual_card", amount_amount: "100.50" }] });
    const submitted = checkedOut.request().postDataJSON();
    expect(submitted).toMatchObject({ expected_balance: 10, confirmed: true, order: { discount_amount: "0.00", items: [{ product_id: prepared.productId, quantity: 1 }], payments: [{ method: "manual_card", amount: "100.50" }] } });
    expect(submitted.order.items[0]).not.toHaveProperty("unit_price_amount");
    const checkoutKey = checkedOut.request().headers()["idempotency-key"];
    expect(checkoutKey).toBeTruthy();
    await expect(page.getByRole("status").filter({ hasText: "Venta completada" })).toBeVisible();
    expect(syncs).toHaveLength(1); // The reward sale never enters the ordinary offline queue.
    expect(await storedCount(page, "kova_reward_recovery", "pending")).toBe(0);
    expect(await ordinarySales(page)).toEqual(baselineOrdinarySales);
    const beforeProcessing = await (await page.request.get(`/api/v1/loyalty/customers/${prepared.customerId}`)).json();
    expect(beforeProcessing.balance).toBe(2);
    expect(beforeProcessing.entries.filter((entry: { kind: string }) => entry.kind === "redemption")).toHaveLength(1);
    const replay = await write(page, "/loyalty/rewards/checkout", submitted, checkoutKey);
    expect(replay).toEqual(order);
    const receipt = await (await page.request.get(`/api/v1/orders/${order.id}/receipt`)).json();
    expect(receipt).toMatchObject({ total_amount: "100.50", discount_amount: "25.00", loyalty_reward: order.loyalty_reward });
    const rewardReceiptLine = page.getByText(/Gracias por volver.*8 puntos/).first();
    await rewardReceiptLine.scrollIntoViewIfNeeded();
    await expect(rewardReceiptLine).toBeInViewport();
    await page.locator(".receipt-template:visible").first().screenshot({ path: testInfo.outputPath("reward-real-receipt-detail.png"), animations: "disabled" });
    await page.screenshot({ path: testInfo.outputPath("reward-real-sale-receipt.png"), fullPage: true, animations: "disabled" });

    await write(page, "/loyalty/process", {});
    const afterProcessing = await (await page.request.get(`/api/v1/loyalty/customers/${prepared.customerId}`)).json();
    expect(afterProcessing).toMatchObject({ balance: 10, adjustments_pending: false });
    expect(afterProcessing.entries.find((entry: { kind: string; sale_order_id: string }) => entry.kind === "accrual" && entry.sale_order_id === order.id)).toMatchObject({ points: 8 });
    const refundKey = crypto.randomUUID();
    const refundBody = { items: [{ order_item_id: order.items[0].id, quantity: 1 }], reason: "customer_return", refund_payment_method: "manual_card" };
    const refund = await write(page, `/orders/${order.id}/refunds`, refundBody, refundKey);
    expect(refund.refunded_amount).toBe("100.50");
    expect(await write(page, `/orders/${order.id}/refunds`, refundBody, refundKey)).toEqual(refund);
    await write(page, "/loyalty/process", {});
    const finalLedger = await (await page.request.get(`/api/v1/loyalty/customers/${prepared.customerId}`)).json();
    expect(finalLedger).toMatchObject({ balance: 10, adjustments_pending: false });
    expect(finalLedger.entries.filter((entry: { kind: string }) => entry.kind === "reward_return")).toHaveLength(1);
    expect(finalLedger.entries.find((entry: { kind: string }) => entry.kind === "reward_return")).toMatchObject({ points: 8, sale_order_id: order.id });
    expect(finalLedger.entries.find((entry: { kind: string; sale_order_id: string }) => entry.kind === "refund" && entry.sale_order_id === order.id)).toMatchObject({ points: -8 });
    const refunds = await (await page.request.get(`/api/v1/orders/${order.id}/refunds`)).json();
    expect(refunds).toHaveLength(1);
    expect((await (await page.request.get("/api/v1/orders")).json()).total).toBe(2);
  });
});
