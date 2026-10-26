import { expect, test } from "./fixtures";
import { createTenantThroughUi, integrationEnabled, logoutThroughUi } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("ciclo del negocio mediante UI con API, Postgres y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack efímero local");

  test("del menú a entrega y postventa; de reposición a recepción parcial y total", async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    // This scenario creates actual operational records, exclusively in a fresh
    // local tenant. APIs prepare master data and read assertions; every action
    // in the lifecycle under test is performed through the application's UI.
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const postResponse = (path: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === "POST");
    const signupResponse = postResponse("/auth/signup");
    await createTenantThroughUi(page, "business-lifecycle");
    const signup = await (await signupResponse).json();
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const prepared = await page.evaluate(async (token: string) => {
      const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf || !token) throw new Error("El setup local requiere CSRF y verificación de desarrollo.");
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
      const customer = await post("/customers", { name: "Cliente ciclo completo local", email: "lifecycle@example.com", phone: null, is_active: true });
      const product = await post("/catalog/products", {
        name: "Producto ciclo completo local", price_amount: "45.00", cost_price: "12.50",
        track_inventory: true, low_stock_threshold: 5,
      });
      await post(`/inventory/products/${product.id}/adjustments`, { quantity_delta: 5, reason: "Existencias efímeras del recorrido completo" });
      const supplier = await post("/purchasing/suppliers", { name: "Proveedor ciclo completo local", contact: null });
      return { customerId: customer.id as string, productId: product.id as string, supplierId: supplier.id as string };
    }, signup.dev_verification_token);
    await page.reload();

    const read = async (path: string) => {
      const response = await page.request.get(`/api/v1${path}`);
      expect(response.ok(), `Lectura real ${path}`).toBe(true);
      return response.json();
    };
    const productStock = async () => (await read("/inventory/stock")).find((row: { product_id: string }) => row.product_id === prepared.productId);
    const assertStock = async (stock: number, reserved: number, available: number) => {
      expect(await productStock()).toMatchObject({ stock_on_hand: stock, reserved_quantity: reserved, available_quantity: available });
    };
    await assertStock(5, 0, 5);
    expect((await read("/orders")).total).toBe(0);

    // Public publication is part of the operator's real workflow, not setup.
    await page.goto("/settings/public-catalog");
    await page.getByLabel("Nombre del menú o negocio").fill("Menú ciclo completo local");
    await page.getByRole("checkbox", { name: /Producto ciclo completo local/ }).check();
    await page.getByRole("checkbox", { name: "Publicar catálogo", exact: true }).check();
    await page.getByRole("button", { name: "Guardar publicación", exact: true }).click();
    const publicLink = page.getByRole("link", { name: "Abrir catálogo público", exact: true });
    await expect(publicLink).toBeVisible();
    const sharePath = await publicLink.getAttribute("href");
    expect(sharePath).toBeTruthy();
    const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let requestId: string;
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(new URL(sharePath!, baseURL).toString());
      await expect(publicPage.getByRole("heading", { name: "Menú ciclo completo local", exact: true })).toBeVisible();
      await publicPage.getByRole("button", { name: "Agregar Producto ciclo completo local al pedido", exact: true }).click();
      await publicPage.getByRole("button", { name: /Ver mi pedido/ }).click();
      await publicPage.getByRole("button", { name: "Agregar uno de Producto ciclo completo local", exact: true }).click();
      await expect(publicPage.getByRole("region", { name: "Tu pedido", exact: true })).toContainText("$90.00");
      await publicPage.getByLabel("Tu nombre", { exact: true }).fill("Solicitud ciclo completo local");
      await publicPage.getByLabel("Teléfono o correo para responder").fill("lifecycle@example.com");
      await publicPage.getByLabel("Notas para el negocio (opcional)").fill("Dos unidades para recoger. Recorrido efímero local.");
      const receivedResponse = publicPage.waitForResponse(response => new URL(response.url()).pathname.endsWith("/requests")
        && new URL(response.url()).pathname.startsWith("/api/v1/public/catalog/") && response.request().method() === "POST");
      await publicPage.getByRole("button", { name: "Enviar solicitud de pedido", exact: true }).click();
      const received = await receivedResponse;
      expect(received.ok()).toBe(true);
      const receipt = await received.json();
      expect(receipt.status).toBe("received");
      requestId = receipt.receipt_id;
      expect(received.request().postDataJSON()).toMatchObject({
        product_ids: [prepared.productId],
        message: expect.stringContaining("2 × Producto ciclo completo local"),
      });
      await expect(publicPage.getByRole("status").filter({ hasText: "Solicitud de pedido recibida" })).toBeVisible();
      await publicPage.screenshot({ path: testInfo.outputPath("lifecycle-public-mobile.png"), fullPage: true });
    } finally {
      await publicContext.close();
    }
    await assertStock(5, 0, 5);
    expect((await read("/orders")).total).toBe(0);

    await page.getByRole("link", { name: "Ver solicitudes del catálogo", exact: true }).click();
    const requestCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Solicitud ciclo completo local", exact: true }) });
    await expect(requestCard).toContainText("2 × Producto ciclo completo local");
    await expect(requestCard).toContainText("Subtotal estimado: $90.00 MXN");
    await requestCard.getByRole("button", { name: "Revisar solicitud de Solicitud ciclo completo local", exact: true }).click();
    await page.getByLabel("Vincular con cliente registrado").selectOption(prepared.customerId);
    const conversionResponse = postResponse(`/crm/requests/${requestId!}/resolve`);
    await page.getByRole("button", { name: "Crear oportunidad con este cliente", exact: true }).click();
    const converted = await (await conversionResponse).json();
    expect(converted).toMatchObject({ id: requestId!, status: "converted", customer_id: prepared.customerId });
    expect(converted.opportunity_id).toBeTruthy();
    await requestCard.getByRole("link", { name: "Ver oportunidad", exact: true }).click();
    const opportunity = page.getByRole("article").filter({ has: page.getByRole("link", { name: "Preparar cotización", exact: true }) });
    await expect(opportunity).toContainText("Cliente ciclo completo local");
    await opportunity.getByRole("link", { name: "Preparar cotización", exact: true }).click();
    await expect(page.getByLabel("Cliente registrado", { exact: true })).toHaveValue(prepared.customerId);
    await expect(page.getByLabel("Oportunidad de origen (opcional)")).toHaveValue(converted.opportunity_id);
    const expiration = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("Vigencia (hora de este dispositivo)").fill(`${expiration}T12:00`);
    await page.getByLabel("Producto", { exact: true }).selectOption(prepared.productId);
    await page.getByLabel("Cantidad", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Agregar producto", exact: true }).click();
    const quoteResponse = postResponse("/quotes");
    await page.getByRole("button", { name: "Crear cotización", exact: true }).click();
    const quote = await (await quoteResponse).json();
    expect(quote).toMatchObject({ customer_id: prepared.customerId, opportunity_id: converted.opportunity_id, total_amount: "90.00", status: "draft" });
    await assertStock(5, 0, 5);
    const quoteCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: `${quote.folio} · Cliente ciclo completo local`, exact: true }) });
    await quoteCard.getByRole("button", { name: "Registrar propuesta compartida", exact: true }).click();
    await quoteCard.getByRole("checkbox", { name: /Confirmo que el equipo ya compartió/ }).check();
    await quoteCard.getByRole("button", { name: "Registrar que fue compartida", exact: true }).click();
    await quoteCard.getByRole("button", { name: "Registrar aceptación", exact: true }).click();
    await quoteCard.getByRole("checkbox", { name: /Confirmo que el cliente aceptó/ }).check();
    const acceptanceResponse = postResponse(`/quotes/${quote.id}/accept`);
    await quoteCard.getByRole("button", { name: "Registrar aceptación y crear pedido", exact: true }).click();
    const accepted = await (await acceptanceResponse).json();
    expect(accepted.status).toBe("accepted");
    const orderId = accepted.customer_order_id as string;
    expect(orderId).toBeTruthy();
    await assertStock(5, 0, 5);
    expect((await read("/orders")).total).toBe(0);
    await quoteCard.getByRole("link", { name: "Revisar pedido creado", exact: true }).click();
    expect(await read(`/customer-orders/${orderId}`)).toMatchObject({ customer_id: prepared.customerId, status: "new", payment_status: "unpaid", total_amount: "90.00" });
    await page.getByRole("button", { name: "Confirmar y reservar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cobrar en Caja", exact: true })).toBeVisible();
    await assertStock(5, 2, 3);
    await page.getByRole("button", { name: "Cobrar en Caja", exact: true }).click();
    await page.getByRole("radio", { name: "Transferencia", exact: true }).click();
    await page.getByLabel("Referencia opcional").fill("LIFECYCLE-TRANSFERENCIA-MANUAL");
    const checkoutResponse = postResponse(`/customer-orders/${orderId}/checkout`);
    await page.getByRole("button", { name: "Cobrar $90.00", exact: true }).click();
    const checkoutResult = await checkoutResponse;
    expect(checkoutResult.ok()).toBe(true);
    const checkout = await checkoutResult.json();
    const saleId = checkout.sale_order.id as string;
    expect(checkout.sale_order).toMatchObject({ customer_id: prepared.customerId, total_amount: "90.00" });
    expect(checkout.sale_order.payments[0]).toMatchObject({ method: "bank_transfer", amount_amount: "90.00" });
    await expect(page.getByRole("heading", { name: "Pedido cobrado", exact: true })).toBeVisible();
    await assertStock(3, 0, 3);
    await page.getByRole("link", { name: "Volver al pedido", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Cobrar en Caja", exact: true })).toHaveCount(0);
    expect((await read("/orders")).total).toBe(1);
    const journey = await read(`/quotes/${quote.id}/journey`);
    expect(journey).toMatchObject({
      catalog_request_id: requestId!, opportunity_id: converted.opportunity_id, customer_order_id: orderId,
      sale_order_id: saleId, sale_total_amount: "90.00", recorded_payments_amount: "90.00", external_collection_verified: false,
    });

    // Delivery is a separate operation from payment; every state is explicit.
    for (const [button, status] of [["Marcar en preparación", "in_progress"], ["Marcar listo", "ready"], ["Marcar entregado", "fulfilled"]]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect.poll(async () => (await read(`/customer-orders/${orderId}`)).status).toBe(status);
    }
    const delivered = await read(`/customer-orders/${orderId}`);
    expect(delivered).toMatchObject({ status: "fulfilled", payment_status: "paid", sale_order_id: saleId });
    expect(delivered.fulfilled_at).not.toBeNull();
    await assertStock(3, 0, 3);
    await page.getByRole("link", { name: "Ver historial y atención del cliente", exact: true }).click();
    const profile = page.getByRole("region", { name: "Ficha del cliente", exact: true });
    await expect(profile).toContainText("Cliente ciclo completo local");
    await expect(profile.getByRole("link", { name: delivered.folio, exact: true })).toHaveAttribute("href", `/pedidos/${orderId}`);
    await expect(page.locator("main").getByRole("link", { name: new RegExp(saleId.slice(0, 8)) })).toHaveAttribute("href", `/orders/${saleId}`);

    // The real sidebar connects customer work to after-sales attention. Closing
    // the case never means refunding the sale or contacting the customer.
    await page.locator("aside nav").getByRole("link", { name: "Atención postventa", exact: true }).click();
    await page.getByRole("button", { name: "Nueva atención postventa", exact: true }).click();
    await page.getByLabel("Cliente de la atención").selectOption(prepared.customerId);
    await page.getByLabel("Venta relacionada").selectOption(saleId);
    await page.getByLabel("Asunto de la atención").fill("Confirmar satisfacción de la entrega local");
    await page.getByLabel("Nota inicial privada").fill("Revisar con el equipo el acuerdo de entrega; sin mensaje externo.");
    const serviceResponse = postResponse("/service-cases");
    await page.getByRole("button", { name: "Registrar atención", exact: true }).click();
    const service = await (await serviceResponse).json();
    expect(service).toMatchObject({ customer_id: prepared.customerId, sale_order_id: saleId, status: "open" });
    await page.getByRole("button", { name: "Abrir atención: Confirmar satisfacción de la entrega local", exact: true }).click();
    await page.getByRole("button", { name: "Revisar estado y responsable", exact: true }).click();
    await page.getByLabel("Nuevo estado de la atención").selectOption("resolved");
    await page.getByRole("button", { name: "Confirmar cambios", exact: true }).click();
    await expect.poll(async () => (await read(`/service-cases/${service.id}`)).status).toBe("resolved");
    expect(await read(`/orders/${saleId}`)).toMatchObject({ status: "completed", total_amount: "90.00" });
    expect(await read(`/orders/${saleId}/refunds`)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("lifecycle-delivery-and-after-sales.png"), fullPage: true });

    // Replenishment is an independent loop. Approving a draft must not change
    // physical stock; partial/total receipts only add the units acknowledged.
    await page.locator("aside nav").getByRole("link", { name: "Operación", exact: true }).click();
    await page.locator("aside nav").getByRole("link", { name: "Reposición", exact: true }).click();
    const suggestion = page.getByRole("article").filter({ has: page.getByRole("checkbox", { name: "Producto ciclo completo local", exact: true }) });
    await expect(suggestion).toContainText("Disponibles");
    await suggestion.getByRole("checkbox", { name: "Producto ciclo completo local", exact: true }).check();
    await suggestion.getByLabel("Cantidad", { exact: true }).fill("4");
    await suggestion.getByLabel("Costo unitario MXN", { exact: true }).fill("12.50");
    await page.getByLabel("Proveedor", { exact: true }).selectOption(prepared.supplierId);
    await page.getByRole("button", { name: "Revisar compra", exact: true }).click();
    const review = page.getByRole("region", { name: "Confirmación de compra", exact: true });
    await expect(review).toContainText("4 × Producto ciclo completo local");
    await expect(review).toContainText("Total de mercancía: $50.00");
    const purchaseResponse = postResponse("/replenishment/approve-purchase");
    await page.getByRole("button", { name: "Confirmar y crear compra pendiente", exact: true }).click();
    const purchaseResult = await purchaseResponse;
    expect(purchaseResult.ok()).toBe(true);
    const purchase = await purchaseResult.json();
    expect(purchase).toMatchObject({ status: "pending", supplier_id: prepared.supplierId });
    expect(purchase.items).toHaveLength(1);
    expect(purchase.items[0]).toMatchObject({ product_id: prepared.productId, quantity: 4, received_quantity: 0, unit_cost: "12.50" });
    await assertStock(3, 0, 3);
    await page.getByRole("link", { name: "Revisar compra creada", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchasing\\?purchase_id=${purchase.id}$`));
    const purchaseCard = page.getByRole("region", { name: `Compra ${purchase.id.slice(0, 8)}`, exact: true });
    await expect(purchaseCard).toBeFocused();
    await purchaseCard.getByRole("button", { name: "Recibir mercancía", exact: true }).click();
    await page.getByLabel("Producto ciclo completo local · pendientes 4", { exact: true }).fill("1");
    const partialResponse = postResponse(`/purchasing/orders/${purchase.id}/receive`);
    await page.getByRole("button", { name: "Confirmar recepción", exact: true }).click();
    expect(await (await partialResponse).json()).toMatchObject({ status: "partial" });
    await expect(purchaseCard).toContainText("1 de 4 recibidas");
    await assertStock(4, 0, 4);
    await purchaseCard.getByRole("button", { name: "Recibir mercancía", exact: true }).click();
    await expect(page.getByLabel("Producto ciclo completo local · pendientes 3", { exact: true })).toHaveValue("3");
    const totalResponse = postResponse(`/purchasing/orders/${purchase.id}/receive`);
    await page.getByRole("button", { name: "Confirmar recepción", exact: true }).click();
    expect(await (await totalResponse).json()).toMatchObject({ status: "received" });
    await expect(purchaseCard).toContainText("4 de 4 recibidas");
    await expect(purchaseCard.getByRole("button", { name: "Recibir mercancía", exact: true })).toHaveCount(0);
    await assertStock(7, 0, 7);
    await page.reload();
    await expect(purchaseCard).toContainText("4 de 4 recibidas");
    await assertStock(7, 0, 7);
    expect((await read("/orders")).total).toBe(1);
    expect((await read(`/quotes/${quote.id}/journey`)).sale_order_id).toBe(saleId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("lifecycle-replenishment-received.png"), fullPage: true });
    await logoutThroughUi(page);
  });
});
