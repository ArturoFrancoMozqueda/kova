import { expect, test } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("cliente, cita y venta con API, Postgres y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere el stack efímero local de integración");

  for (const width of [1440, 390]) {
    test(`el dueño continúa de la ficha a la cita y conserva su venta a ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      // This test creates actual records. It must never target a hosted tenant.
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      const signupResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/signup")
        && response.request().method() === "POST");
      await createTenantThroughUi(page, `connected-${width}`);
      const signup = await (await signupResponse).json();
      const session = await (await page.request.get("/api/v1/auth/session")).json();
      await markFirstUseToursSeen(page, session.tenant_id);
      const prepared = await page.evaluate(async (token: string) => {
        const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
        if (!csrf) throw new Error("La preparación local requiere una sesión CSRF real.");
        const post = async (path: string, body: unknown) => {
          const response = await fetch(`/api/v1${path}`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
          return response.json();
        };
        await post("/auth/verify", { token });
        const customer = await post("/customers", { name: "Cliente recorrido local", email: null, phone: null, is_active: true });
        const product = await post("/catalog/products", { name: "Servicio recorrido local", price_amount: "125.50", track_inventory: false });
        const resource = await post("/appointments/resources", { name: "Atención recorrido local", timezone: "America/Mexico_City" });
        return { customer_id: customer.id as string, product_id: product.id as string, resource_id: resource.id as string };
      }, signup.dev_verification_token);

      // Reload initializes the verified session and the tenant-specific tour
      // preference before continuing through client-side navigation.
      await page.reload();
      if (width < 1280) await page.getByRole("button", { name: "Abrir menú de navegación" }).first().click();
      await page.locator("aside nav").getByRole("button", { name: "Clientes y atención", exact: true }).click();
      await page.locator("aside nav").getByRole("link", { name: "Clientes", exact: true }).click();
      await page.getByRole("button", { name: "Ver cliente", exact: true }).click();
      const profile = page.getByRole("region", { name: "Ficha del cliente" });
      await expect(profile.getByRole("heading", { name: "Cliente recorrido local", exact: true })).toBeFocused();
      await profile.getByRole("link", { name: "Agendar cita", exact: true }).click();
      await expect(page.getByLabel("Cliente de la cita")).toHaveValue(prepared.customer_id);
      await page.getByLabel("Recurso de la cita").selectOption(prepared.resource_id);
      await page.getByLabel("Motivo de la cita").fill("Atención del recorrido local");
      const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Inicio de la cita").fill(`${day}T10:00`);
      await page.getByLabel("Fin de la cita").fill(`${day}T11:00`);
      const bookingResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/appointments")
        && response.request().method() === "POST");
      await page.getByRole("button", { name: "Confirmar cita", exact: true }).click();
      const bookingResult = await bookingResponse;
      expect(bookingResult.ok()).toBe(true);
      const booking = await bookingResult.json();
      expect(booking.customer_id).toBe(prepared.customer_id);
      expect(booking.sale).toBeNull();
      expect((await (await page.request.get("/api/v1/orders")).json()).total).toBe(0);

      const appointment = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Atención del recorrido local", exact: true }) });
      await appointment.getByRole("link", { name: "Cobrar al cliente", exact: true }).click();
      await expect(page.getByRole("region", { name: "Continuar con el cliente" })).toContainText("Venta para Cliente recorrido local");
      await page.getByRole("button", { name: "Agregar Servicio recorrido local", exact: true }).click();
      await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
      const saleResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/sync/offline-sales")
        && response.request().method() === "POST");
      await page.getByRole("button", { name: "Cobrar", exact: true }).click();
      const saleResult = await saleResponse;
      expect(saleResult.ok()).toBe(true);
      const syncPayload = saleResult.request().postDataJSON();
      expect(syncPayload.sales).toHaveLength(1);
      expect(syncPayload.sales[0].order).toMatchObject({ customer_id: prepared.customer_id,
        items: [{ product_id: prepared.product_id, quantity: 1 }], payments: [{ method: "manual_card", amount: "125.50" }] });
      const synced = await saleResult.json();
      expect(synced.results).toHaveLength(1);
      expect(synced.results[0].status).toBe("synced");
      const sale = synced.results[0].order;
      expect(sale.customer_id).toBe(prepared.customer_id);
      expect(sale.total_amount).toBe("125.50");
      // Manual card is a payment record; the flow never invokes a payment provider.
      await page.getByRole("link", { name: "Volver a la cita y vincular venta", exact: true }).click();
      await expect(appointment).toBeVisible();
      await appointment.getByRole("button", { name: "Vincular venta existente", exact: true }).click();
      await appointment.getByLabel("Venta que corresponde a la cita").selectOption(sale.id);
      const linkResponse = page.waitForResponse(response => response.url().endsWith(`/api/v1/appointments/${booking.id}/sale`)
        && response.request().method() === "POST");
      await appointment.getByRole("button", { name: "Confirmar vínculo de venta", exact: true }).click();
      expect((await linkResponse).ok()).toBe(true);
      await expect(appointment.getByText("Venta vinculada · $125.50", { exact: true })).toBeVisible();
      await page.reload();
      await expect(appointment.getByRole("link", { name: "Ver venta y comprobante", exact: true })).toHaveAttribute("href", `/orders/${sale.id}`);
      const persisted = await (await page.request.get(`/api/v1/appointments/${booking.id}`)).json();
      expect(persisted.sale.id).toBe(sale.id);
      expect(persisted.status).toBe("scheduled");
      const history = await (await page.request.get(`/api/v1/appointments/${booking.id}/history`)).json();
      expect(history.items.map((item: { action: string }) => item.action).sort()).toEqual(["created", "sale_linked"]);
      expect((await (await page.request.get("/api/v1/orders")).json()).total).toBe(1);

      await appointment.getByRole("link", { name: "Ver cliente y su historial", exact: true }).click();
      await expect(profile).toContainText("Cliente recorrido local");
      await expect(profile.getByRole("region", { name: "Actividad del cliente" }).getByRole("link", { name: "Atención del recorrido local", exact: true }))
        .toHaveAttribute("href", `/appointments?appointmentId=${booking.id}`);
      // The product intentionally hides internal IDs; the human label still opens the exact sale.
      const saleHistoryLink = page.locator("main").getByRole("link", { name: "Venta completada", exact: true });
      await expect(saleHistoryLink).toHaveAttribute("href", `/orders/${sale.id}`);
      await expect(saleHistoryLink).not.toContainText(sale.id.slice(0, 8));
      await expect(page.getByRole("button", { name: "Ver cliente", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`connected-owner-${width}.png`), fullPage: true });
    });
  }

  test("un pedido del cliente conserva identidad, reserva y venta en el mismo historial", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const signupResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/signup")
      && response.request().method() === "POST");
    await createTenantThroughUi(page, "connected-commerce");
    const signup = await (await signupResponse).json();
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const prepared = await page.evaluate(async (token: string) => {
      const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf) throw new Error("La preparación local requiere una sesión CSRF real.");
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`/api/v1${path}`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
        return response.json();
      };
      await post("/auth/verify", { token });
      const customer = await post("/customers", { name: "Cliente pedido local", email: null, phone: "525550000000", is_active: true });
      const product = await post("/catalog/products", { name: "Producto pedido local", price_amount: "80.00", track_inventory: true });
      await post(`/inventory/products/${product.id}/adjustments`, { quantity_delta: 5, reason: "Existencias efímeras para recorrido local" });
      return { customer_id: customer.id as string, product_id: product.id as string };
    }, signup.dev_verification_token);
    await page.reload();
    await page.locator("aside nav").getByRole("button", { name: "Clientes y atención", exact: true }).click();
      await page.locator("aside nav").getByRole("link", { name: "Clientes", exact: true }).click();
    await page.getByRole("button", { name: "Ver cliente", exact: true }).click();
    await page.getByRole("region", { name: "Ficha del cliente" }).getByRole("link", { name: "Nuevo pedido", exact: true }).click();
    await expect(page.getByLabel("Cliente registrado", { exact: true })).toHaveValue(prepared.customer_id);
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Cliente pedido local");
    await page.getByRole("button", { name: "Agregar Producto pedido local", exact: true }).click();
    const creationResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/customer-orders")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Guardar y confirmar", exact: true }).click();
    const creationResult = await creationResponse;
    expect(creationResult.ok()).toBe(true);
    expect(creationResult.request().postDataJSON().customer_id).toBe(prepared.customer_id);
    const created = await creationResult.json();
    await expect(page).toHaveURL(new RegExp(`/pedidos/${created.id}$`));
    const confirmed = await (await page.request.get(`/api/v1/customer-orders/${created.id}`)).json();
    expect(confirmed.customer_id).toBe(prepared.customer_id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.payment_status).toBe("unpaid");
    const stockBefore = await (await page.request.get("/api/v1/inventory/stock")).json();
    expect(stockBefore.find((item: { product_id: string }) => item.product_id === prepared.product_id))
      .toMatchObject({ stock_on_hand: 5, reserved_quantity: 1, available_quantity: 4 });
    await page.getByRole("link", { name: "Editar", exact: true }).click();
    await expect(page.getByText("La asociación se conserva al editar.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Cliente registrado", { exact: true })).toHaveCount(0);
    await page.goBack();
    await page.getByRole("button", { name: "Cobrar en Caja", exact: true }).click();
    await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
    const checkoutResponse = page.waitForResponse(response => response.url().endsWith(`/api/v1/customer-orders/${created.id}/checkout`)
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cobrar $80.00", exact: true }).click();
    const checkoutResult = await checkoutResponse;
    expect(checkoutResult.ok()).toBe(true);
    const checkout = await checkoutResult.json();
    expect(checkout.sale_order.customer_id).toBe(prepared.customer_id);
    expect(checkout.sale_order.payments[0].method).toBe("manual_card");
    expect(checkout.customer_order.payment_status).toBe("paid");
    await expect(page.getByRole("heading", { name: "Pedido cobrado", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Volver al pedido", exact: true }).click();
    await page.reload();
    const stockAfter = await (await page.request.get("/api/v1/inventory/stock")).json();
    expect(stockAfter.find((item: { product_id: string }) => item.product_id === prepared.product_id))
      .toMatchObject({ stock_on_hand: 4, reserved_quantity: 0, available_quantity: 4 });
    await page.getByRole("link", { name: "Ver historial y atención del cliente", exact: true }).click();
    await expect(page.getByRole("region", { name: "Actividad del cliente" }).getByRole("link", { name: created.folio, exact: true }))
      .toHaveAttribute("href", `/pedidos/${created.id}`);
    const saleHistoryLink = page.locator("main").getByRole("link", { name: "Venta completada", exact: true });
    await expect(saleHistoryLink).toHaveAttribute("href", `/orders/${checkout.sale_order.id}`);
    await expect(saleHistoryLink).not.toContainText(checkout.sale_order.id.slice(0, 8));
    expect((await (await page.request.get("/api/v1/orders")).json()).total).toBe(1);
    await expect(page.getByRole("button", { name: "Ver cliente", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("connected-commerce.png"), fullPage: true });
  });
});
