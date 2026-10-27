import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";

test.describe("menú, pedido y seguimiento con API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack efímero local");

  test("la solicitud pública se revisa, reserva, cobra y entrega sin duplicar operaciones", async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    // Real writes belong exclusively to a new disposable local tenant. No API
    // interception, hosted tenant, payment provider or outbound message is used.
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const postResponse = (path: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === "POST");
    const signupResponse = postResponse("/auth/signup");
    await createTenantThroughUi(page, "order-intake-real");
    const signup = await (await signupResponse).json();
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const prepared = await page.evaluate(async (token: string) => {
      const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf || !token) throw new Error("El setup local requiere CSRF y verificación de desarrollo.");
      const write = async (path: string, method: string, body: unknown) => {
        const response = await fetch(`/api/v1${path}`, {
          method, credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
        return response.json();
      };
      await write("/auth/verify", "POST", { token });
      await write("/settings/business-profile", "PUT", {
        public_name: "Café del Patio", support_email: null, support_phone: null,
        timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN",
      });
      const product = await write("/catalog/products", "POST", { name: "Pan de nuez", price_amount: "45.00", track_inventory: true });
      await write(`/inventory/products/${product.id}/adjustments`, "POST", { quantity_delta: 5, reason: "Existencias efímeras del recorrido local" });
      return { productId: product.id as string };
    }, signup.dev_verification_token);
    await page.reload();
    const read = async (path: string) => {
      const response = await page.request.get(`/api/v1${path}`);
      expect(response.ok(), `Lectura local ${path}`).toBe(true);
      return response.json();
    };
    const stock = async () => (await read("/inventory/stock"))
      .find((row: { product_id: string }) => row.product_id === prepared.productId);
    const assertStock = async (onHand: number, reserved: number, available: number) => {
      expect(await stock()).toMatchObject({ stock_on_hand: onHand, reserved_quantity: reserved, available_quantity: available });
    };

    await page.goto("/settings/public-catalog");
    await page.getByLabel("Nombre del menú o negocio").fill("Café del Patio");
    await page.getByRole("checkbox", { name: /Pan de nuez/ }).check();
    await page.getByRole("checkbox", { name: "Publicar catálogo", exact: true }).check();
    await page.getByRole("button", { name: "Guardar publicación", exact: true }).click();
    const menuLink = page.getByRole("link", { name: "Abrir catálogo público", exact: true });
    await expect(menuLink).toBeVisible();
    const menuPath = await menuLink.getAttribute("href");
    expect(menuPath).toMatch(/^\/catalogo\//);

    const anonymousContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const anonymous = await anonymousContext.newPage();
      await anonymous.emulateMedia({ reducedMotion: "reduce" });
      await anonymous.goto(new URL(menuPath!, baseURL).toString());
      await anonymous.getByRole("button", { name: "Agregar Pan de nuez al pedido", exact: true }).click();
      await anonymous.getByRole("button", { name: /Ver mi pedido/ }).click();
      await anonymous.getByRole("button", { name: "Agregar uno de Pan de nuez", exact: true }).click();
      await expect(anonymous.getByRole("region", { name: "Tu pedido", exact: true })).toContainText("$90.00");
      await anonymous.getByLabel("Tu nombre", { exact: true }).fill("Ana");
      await anonymous.getByLabel("Teléfono o correo para responder").fill("ana@example.com");
      await anonymous.getByLabel("Notas para el negocio (opcional)").fill("Sin calentar, por favor.");
      const intakeResponse = anonymous.waitForResponse(response => new URL(response.url()).pathname.startsWith("/api/v1/public/catalog/")
        && new URL(response.url()).pathname.endsWith("/requests") && response.request().method() === "POST");
      await anonymous.getByRole("button", { name: "Enviar solicitud de pedido", exact: true }).click();
      const intake = await intakeResponse;
      expect(intake.status()).toBe(201);
      expect(intake.request().headers().cookie).toBeUndefined();
      expect(intake.request().postDataJSON()).toMatchObject({ product_ids: [prepared.productId],
        order_lines: [{ product_id: prepared.productId, quantity: 2 }], origin: "remote" });
      const receipt = await intake.json();
      expect(receipt).toMatchObject({ status: "received", tracking_path: expect.stringMatching(/^\/seguimiento#.+$/) });
      await expect(anonymous).toHaveURL(new RegExp(`/seguimiento#.+$`));
      await expect(anonymous.getByRole("region", { name: "Estado de tu solicitud", exact: true }).getByRole("status")).toContainText("Solicitud recibida");
      await expect(anonymous.getByText("Total registrado", { exact: true })).toHaveCount(0);
      const trackingUrl = anonymous.url();
      await assertStock(5, 0, 5);
      expect((await read("/orders")).total).toBe(0);
      expect((await read("/customer-orders")).total).toBe(0);

      await page.goto("/commercial-requests");
      await page.getByRole("button", { name: "Revisar pedido de Ana", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Revisar pedido de Ana", exact: true });
      await expect(review.getByText("2 × Pan de nuez", { exact: true })).toBeVisible();
      await expect(review.getByText("$45.00 cada uno", { exact: true })).toBeVisible();
      await expect(review.getByText("$90.00 MXN", { exact: true })).toBeVisible();
      const create = review.getByRole("button", { name: "Crear pedido para confirmar", exact: true });
      await expect(create).toBeDisabled();
      await review.getByRole("button", { name: "Registrar cliente sin salir", exact: true }).click();
      await expect(review.getByLabel("Correo del cliente (opcional)")).toHaveValue("");
      await review.getByLabel("Nombre del cliente", { exact: true }).fill("Ana del Patio");
      const customerResponse = postResponse("/customers");
      await review.getByRole("button", { name: "Guardar y usar cliente", exact: true }).click();
      const customerSaved = await customerResponse;
      expect(customerSaved.status()).toBe(201);
      const customerId = (await customerSaved.json()).id as string;
      await expect(review.getByLabel("Vincular con cliente registrado")).toHaveValue(customerId);
      await expect(review.getByText("2 × Pan de nuez", { exact: true })).toBeVisible();
      await review.getByLabel(/Revisé productos, cantidades, precios y cliente/).check();
      const acceptedResponse = postResponse(`/crm/requests/${receipt.receipt_id}/accept-order`);
      await create.click();
      const acceptance = await acceptedResponse;
      expect(acceptance.status()).toBe(201);
      const accepted = await acceptance.json();
      expect(accepted.request).toMatchObject({ status: "accepted", customer_id: customerId, customer_order_id: accepted.customer_order.id });
      expect(accepted.customer_order.note).toBe("Pedido desde el menú digital");
      expect(accepted.customer_order.menu_request_message).toContain("Sin calentar, por favor.");
      expect(accepted.customer_order).toMatchObject({ status: "new", payment_status: "unpaid", total_amount: "90.00", customer_id: customerId });
      const created = page.getByRole("dialog", { name: "Pedido creado", exact: true });
      await expect(created.getByRole("status")).toContainText("Confirma el pedido para reservar sus productos");
      await assertStock(5, 0, 5);
      expect((await read("/customer-orders")).total).toBe(1);
      expect((await read("/orders")).total).toBe(0);
      await created.getByRole("link", { name: "Abrir pedido", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/pedidos/${accepted.customer_order.id}$`));
      await expect(page.getByText(/Notas: Sin calentar, por favor/)).toBeVisible();
      const confirmationResponse = postResponse(`/customer-orders/${accepted.customer_order.id}/confirm`);
      await page.getByRole("button", { name: "Confirmar y reservar", exact: true }).click();
      expect((await confirmationResponse).status()).toBe(200);
      await assertStock(5, 2, 3);
      await anonymous.getByRole("button", { name: "Actualizar estado", exact: true }).click();
      await expect(anonymous.getByRole("region", { name: "Estado de tu solicitud", exact: true }).getByRole("status")).toContainText("Pedido confirmado");

      await page.getByRole("button", { name: "Cobrar en Caja", exact: true }).click();
      await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
      const checkoutResponse = postResponse(`/customer-orders/${accepted.customer_order.id}/checkout`);
      await page.getByRole("button", { name: "Cobrar $90.00", exact: true }).click();
      const checkout = await checkoutResponse;
      expect(checkout.status()).toBe(201);
      const paid = await checkout.json();
      expect(paid.sale_order).toMatchObject({ customer_id: customerId, total_amount: "90.00" });
      expect(paid.sale_order.payments[0]).toMatchObject({ method: "manual_card", amount_amount: "90.00" });
      await expect(page.getByRole("heading", { name: "Pedido cobrado", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Volver al pedido", exact: true }).click();
      await assertStock(3, 0, 3);

      for (const [button, status] of [["Marcar en preparación", "in_progress"], ["Marcar listo", "ready"], ["Marcar entregado", "fulfilled"]]) {
        const changedResponse = postResponse(`/customer-orders/${accepted.customer_order.id}/status`);
        await page.getByRole("button", { name: button, exact: true }).click();
        const changed = await changedResponse;
        expect(changed.status()).toBe(200);
        expect((await changed.json()).status).toBe(status);
      }
      const trackingResponse = anonymous.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/public/order-tracking"
        && response.request().method() === "POST");
      await anonymous.getByRole("button", { name: "Actualizar estado", exact: true }).click();
      const tracked = await trackingResponse;
      expect(tracked.ok()).toBe(true);
      expect(tracked.request().headers().cookie).toBeUndefined();
      expect(tracked.request().headers().referer ?? "").toBe("");
      const tracking = await tracked.json();
      expect(tracking).toMatchObject({ business_name: "Café del Patio", status: "fulfilled", total_amount: "90.00",
        folio: accepted.customer_order.folio, items: [{ product_name: "Pan de nuez", quantity: 2 }] });
      for (const field of ["customer_id", "customer_name", "contact", "email", "phone", "payments", "sale_order_id"]) {
        expect(tracking).not.toHaveProperty(field);
      }
      await expect(anonymous.getByRole("region", { name: "Estado de tu solicitud", exact: true }).getByRole("status")).toContainText("Pedido entregado");
      await expect(anonymous.getByText("$90.00 MXN", { exact: true })).toBeVisible();
      expect(anonymous.url()).toBe(trackingUrl);
      expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await anonymous.screenshot({ path: testInfo.outputPath("order-intake-delivered-real-mobile.png"), fullPage: true });
      await assertStock(3, 0, 3);
      expect((await read("/orders")).total).toBe(1);
      expect((await read("/customer-orders")).total).toBe(1);
    } finally {
      await anonymousContext.close();
    }
  });
});
