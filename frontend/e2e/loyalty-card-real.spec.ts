import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";

test.describe("tarjeta de lealtad con ventas, API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack efímero local");

  test("una compra registrada llega a la tarjeta anónima y regresa al menú en móvil", async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    // This scenario writes real operational records, exclusively to a fresh local
    // tenant. It must never target production or a hosted development tenant.
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 390, height: 844 });
    const postResponse = (path: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === "POST");
    const signupResponse = postResponse("/auth/signup");
    await createTenantThroughUi(page, "loyalty-card-real");
    const signup = await (await signupResponse).json();
    const sessionResponse = await page.request.get("/api/v1/auth/session");
    expect(sessionResponse.ok()).toBe(true);
    const session = await sessionResponse.json();
    await markFirstUseToursSeen(page, session.tenant_id);

    // Only master data and the explicit loyalty policy are prepared through
    // authenticated APIs. The sale, publication and share happen in the UI.
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
      const customer = await write("/customers", "POST", { name: "Cliente tarjeta local", email: null, phone: null, is_active: true });
      const product = await write("/catalog/products", "POST", { name: "Café tarjeta local", price_amount: "125.50", track_inventory: false });
      await write("/loyalty/policy", "PUT", { expected_version: 0, enabled: true, spend_amount: "25.00", points_per_step: 2 });
      return { customerId: customer.id as string, productId: product.id as string };
    }, signup.dev_verification_token);
    await page.reload();

    await page.goto("/settings/public-catalog");
    await page.getByLabel("Nombre del menú o negocio").fill("Menú tarjeta local");
    await page.getByRole("checkbox", { name: /Café tarjeta local/ }).check();
    await page.getByRole("checkbox", { name: "Publicar catálogo", exact: true }).check();
    await page.getByRole("button", { name: "Guardar publicación", exact: true }).click();
    const menuLink = page.getByRole("link", { name: "Abrir catálogo público", exact: true });
    await expect(menuLink).toBeVisible();
    const menuPath = await menuLink.getAttribute("href");
    expect(menuPath).toMatch(/^\/catalogo\//);

    await page.goto("/customers");
    await page.getByRole("button", { name: "Ver cliente", exact: true }).click();
    const profile = page.getByRole("region", { name: "Ficha del cliente", exact: true });
    await expect(profile).toContainText("Cliente tarjeta local");
    await profile.getByRole("link", { name: "Nueva venta", exact: true }).click();
    await expect(page.getByRole("region", { name: "Continuar con el cliente" })).toContainText("Venta para Cliente tarjeta local");
    await page.getByRole("button", { name: "Agregar Café tarjeta local", exact: true }).click();
    await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
    const saleResponse = postResponse("/sync/offline-sales");
    await page.getByRole("button", { name: "Cobrar", exact: true }).click();
    const saleResult = await saleResponse;
    expect(saleResult.ok()).toBe(true);
    const synced = await saleResult.json();
    expect(synced.results).toHaveLength(1);
    expect(synced.results[0]).toMatchObject({ status: "synced", order: {
      customer_id: prepared.customerId, total_amount: "125.50",
    } });
    expect(saleResult.request().postDataJSON().sales[0].order).toMatchObject({
      customer_id: prepared.customerId, items: [{ product_id: prepared.productId, quantity: 1 }],
      payments: [{ method: "manual_card", amount: "125.50" }],
    });

    await page.goto("/loyalty");
    await expect(page.getByRole("heading", { name: "Lealtad de clientes", exact: true })).toBeVisible();
    const processResponse = postResponse("/loyalty/process");
    await page.getByRole("button", { name: "Actualizar movimientos de puntos", exact: true }).click();
    const processed = await processResponse;
    expect(processed.ok()).toBe(true);
    // A background worker may have already materialized the sale. Either way,
    // the ledger must contain exactly one accrual and the same real balance.
    expect([0, 1]).toContain((await processed.json()).created);
    await page.getByLabel("Cliente del programa", { exact: true }).selectOption(prepared.customerId);
    await expect(page.getByLabel("Saldo de puntos", { exact: true })).toHaveText("10 puntos");
    const ledgerResponse = await page.request.get(`/api/v1/loyalty/customers/${prepared.customerId}`);
    expect(ledgerResponse.ok()).toBe(true);
    const ledger = await ledgerResponse.json();
    expect(ledger).toMatchObject({ balance: 10, adjustments_pending: false });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ kind: "accrual", points: 10, sale_order_id: synced.results[0].order.id });

    const share = page.getByRole("region", { name: "Tarjeta digital del cliente", exact: true });
    const issuedResponse = postResponse(`/loyalty/customers/${prepared.customerId}/digital-card`);
    await share.getByRole("button", { name: "Crear enlace de tarjeta digital", exact: true }).click();
    expect((await issuedResponse).ok()).toBe(true);
    const cardInput = share.getByLabel("Enlace de la tarjeta", { exact: true });
    await expect(cardInput).toHaveValue(/\/lealtad#.+$/);
    const cardUrl = await cardInput.inputValue();
    expect(new URL(cardUrl).origin).toBe(new URL(baseURL!).origin);

    const anonymousContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const anonymous = await anonymousContext.newPage();
      const publicResponse = anonymous.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/public/loyalty/cards"
        && response.request().method() === "POST");
      await anonymous.goto(cardUrl);
      const publicResult = await publicResponse;
      expect(publicResult.ok()).toBe(true);
      expect(publicResult.request().headers().cookie).toBeUndefined();
      // Chromium's real network stack may report no-referrer as an empty
      // header value; both representations carry zero referrer information.
      expect(publicResult.request().headers().referer ?? "").toBe("");
      const body = await publicResult.json();
      expect(body).toMatchObject({ business_name: "Café del Patio", balance: 10, adjustments_pending: false, catalog_path: menuPath,
        policy: { enabled: true, spend_amount: "25.00", points_per_step: 2 } });
      for (const privateField of ["customer_id", "customer_name", "email", "phone", "entries"]) {
        expect(body).not.toHaveProperty(privateField);
      }
      await expect(anonymous.getByLabel("Tus puntos", { exact: true })).toHaveText("10");
      await expect(anonymous.getByRole("heading", { name: body.business_name, exact: true })).toBeVisible();
      await expect(anonymous.getByRole("button", { name: /canjear|pagar/i })).toHaveCount(0);
      expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await anonymous.screenshot({ path: testInfo.outputPath("loyalty-card-real-mobile.png"), fullPage: true });
      await anonymous.getByRole("link", { name: "Ver menú del negocio", exact: true }).click();
      await expect(anonymous.getByRole("heading", { name: "Menú tarjeta local", exact: true })).toBeVisible();
      await expect(anonymous.getByRole("button", { name: "Agregar Café tarjeta local al pedido", exact: true })).toBeVisible();
      expect(new URL(anonymous.url()).pathname).toBe(menuPath);
      expect(new URL(anonymous.url()).hash).toBe("");
      await anonymous.screenshot({ path: testInfo.outputPath("loyalty-card-real-menu-mobile.png"), fullPage: true });
    } finally {
      await anonymousContext.close();
    }
    const orders = await page.request.get("/api/v1/orders");
    expect(orders.ok()).toBe(true);
    expect((await orders.json()).total).toBe(1);
  });
});
