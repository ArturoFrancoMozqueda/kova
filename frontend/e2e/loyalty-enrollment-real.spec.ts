import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";

test.describe("tarjeta desde el menú con API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack efímero local");

  test("el cliente obtiene su tarjeta, conserva su pedido y canjea puntos en Caja", async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    expect(baseURL).toBeTruthy();
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const postResponse = (path: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === "POST");
    const signupResponse = postResponse("/auth/signup");
    await createTenantThroughUi(page, "web-membership-real");
    const signup = await (await signupResponse).json();
    const session = await (await page.request.get("/api/v1/auth/session")).json();
    await markFirstUseToursSeen(page, session.tenant_id);

    // Masters only. Publication, enrollment opt-in, member identification and
    // both sales are real UI actions in a fresh local tenant, never production.
    const product = await page.evaluate(async (token: string) => {
      const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
      if (!csrf || !token) throw new Error("El setup local requiere CSRF y verificación de desarrollo.");
      const write = async (path: string, method: string, body: unknown) => {
        const response = await fetch(`/api/v1${path}`, { method, credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
        return response.json();
      };
      await write("/auth/verify", "POST", { token });
      await write("/settings/business-profile", "PUT", { public_name: "Café del Patio", support_email: null, support_phone: null,
        timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN" });
      const product = await write("/catalog/products", "POST", { name: "Latte del Patio", price_amount: "125.50", cost_price: "45.00", track_inventory: false });
      await write("/loyalty/policy", "PUT", { expected_version: 0, enabled: true, spend_amount: "25.00", points_per_step: 2 });
      await write("/loyalty/rewards", "PUT", { expected_version: 0, enabled: true, title: "Gracias por volver", points_cost: 8, discount_amount: "25.00" });
      return { id: product.id as string };
    }, signup.dev_verification_token);

    await page.goto("/settings/public-catalog");
    await page.getByLabel("Nombre del menú o negocio").fill("Café del Patio");
    await page.getByRole("checkbox", { name: /Latte del Patio/ }).check();
    await page.getByRole("checkbox", { name: "Publicar catálogo", exact: true }).check();
    await page.getByRole("button", { name: "Guardar publicación", exact: true }).click();
    const publicLink = page.getByRole("link", { name: "Abrir catálogo público", exact: true });
    await expect(publicLink).toBeVisible();
    const menuPath = await publicLink.getAttribute("href");
    expect(menuPath).toMatch(/^\/catalogo\//);
    await page.goto("/loyalty");
    const settings = page.getByRole("region", { name: "Tarjetas desde el menú", exact: true });
    await settings.getByRole("button", { name: "Configurar tarjetas", exact: true }).click();
    const allow = settings.getByRole("checkbox", { name: "Permitir nuevas tarjetas desde el menú", exact: true });
    await expect(allow).not.toBeChecked();
    await allow.check();
    const policySaved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/loyalty/enrollment-policy" && response.request().method() === "PUT");
    await settings.getByRole("button", { name: "Guardar acceso a tarjetas", exact: true }).click();
    expect((await policySaved).ok()).toBe(true);

    const anonymousContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const menu = await anonymousContext.newPage();
      await menu.emulateMedia({ reducedMotion: "reduce" });
      await menu.goto(new URL(menuPath!, baseURL).toString());
      await menu.getByRole("button", { name: "Agregar Latte del Patio al pedido", exact: true }).click();
      await menu.getByRole("button", { name: /Tu tarjeta de lealtad/ }).click();
      const enrollment = menu.getByRole("dialog", { name: "Tu tarjeta en Café del Patio", exact: true });
      const create = enrollment.getByRole("button", { name: "Crear mi tarjeta", exact: true });
      await expect(create).toBeDisabled();
      await enrollment.getByLabel("¿Cómo te llamamos?", { exact: true }).fill("Ana");
      await enrollment.getByRole("checkbox", { name: "Quiero crear mi tarjeta personal en este dispositivo.", exact: true }).check();
      const enrolledResponse = menu.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/public/loyalty/membership/enroll" && response.request().method() === "POST");
      await create.click();
      const enrolled = await enrolledResponse;
      expect(enrolled.status()).toBe(201);
      const issued = await enrolled.json();
      expect(issued.card).toMatchObject({ balance: 0, business_name: "Café del Patio", reward: { title: "Gracias por volver", points_cost: 8, discount_amount: "25.00" } });
      expect(issued.card.member_code).toMatch(/^KV-(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$/);
      expect(enrolled.request().headers().cookie ?? "").not.toContain("access_token=");
      expect(enrolled.headers()["cache-control"]).toContain("no-store");
      for (const field of ["customer_id", "email", "phone", "entries"]) expect(issued.card).not.toHaveProperty(field);
      const cardPromise = anonymousContext.waitForEvent("page");
      await enrollment.getByRole("link", { name: /Ver mi tarjeta/ }).click();
      const card = await cardPromise;
      await expect(card.getByLabel("Tus puntos", { exact: true })).toHaveText("0");
      await expect(card.getByAltText("Tu tarjeta para presentar en caja")).toBeVisible();
      await expect(card.getByLabel("Número de tarjeta", { exact: true })).toBeHidden();
      await card.getByText("Usar número de tarjeta", { exact: true }).click();
      await expect(card.getByLabel("Número de tarjeta", { exact: true })).toHaveValue(issued.card.member_code);
      await card.getByText("Usar número de tarjeta", { exact: true }).click();
      await expect(card.getByText("Te faltan 8 puntos.", { exact: true })).toBeVisible();
      await menu.getByRole("button", { name: "Cerrar", exact: true }).click();
      await menu.getByRole("button", { name: /Ver mi pedido/ }).click();
      await expect(menu.getByRole("region", { name: "Tu pedido", exact: true })).toContainText("$125.50");
      await card.reload();
      await expect(card.getByLabel("Número de tarjeta", { exact: true })).toHaveValue(issued.card.member_code);
      const memberCookies = (await anonymousContext.cookies()).filter(cookie => cookie.path === "/api/v1/public/loyalty");
      expect(memberCookies.length).toBeGreaterThan(0);
      expect(memberCookies.every(cookie => cookie.httpOnly && cookie.sameSite === "Strict")).toBe(true);

      const identify = async () => {
        await page.getByRole("button", { name: "Identificar tarjeta", exact: true }).click();
        const lookup = page.getByRole("region", { name: "Identificar tarjeta de lealtad", exact: true });
        await lookup.getByLabel("Número de tarjeta", { exact: true }).fill(issued.card.member_code);
        const resolvedResponse = postResponse("/loyalty/members/resolve");
        await lookup.getByRole("button", { name: "Buscar tarjeta", exact: true }).click();
        const resolved = await resolvedResponse;
        expect(resolved.ok()).toBe(true);
        const result = await resolved.json();
        expect(result.customer.name).toBe("Ana");
        await lookup.getByRole("button", { name: "Usar cliente", exact: true }).click();
        await expect(page.getByRole("region", { name: "Cliente de esta venta", exact: true })).toContainText("Ana");
        return result.customer.id as string;
      };
      await page.goto("/register");
      await page.getByRole("button", { name: "Agregar Latte del Patio", exact: true }).click();
      const customerId = await identify();
      await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
      const firstSaleResponse = postResponse("/sync/offline-sales");
      await page.getByRole("button", { name: /^Cobrar$/ }).click();
      const first = await (await firstSaleResponse).json();
      expect(first.results).toHaveLength(1);
      expect(first.results[0]).toMatchObject({ status: "synced", order: { customer_id: customerId, total_amount: "125.50" } });
      await page.goto("/loyalty");
      const processResponse = postResponse("/loyalty/process");
      await page.getByRole("button", { name: "Actualizar movimientos de puntos", exact: true }).click();
      expect((await processResponse).ok()).toBe(true);
      await card.getByRole("button", { name: "Actualizar puntos", exact: true }).click();
      await expect(card.getByLabel("Tus puntos", { exact: true })).toHaveText("10");
      await expect(card.getByText("Disponible para ti", { exact: true })).toBeVisible();
      await card.screenshot({ path: testInfo.outputPath("member-card-earned-mobile.png"), fullPage: true });

      await page.goto("/register");
      await page.getByRole("button", { name: "Agregar Latte del Patio", exact: true }).click();
      expect(await identify()).toBe(customerId);
      await page.getByText("Cliente, descuento e impuesto", { exact: true }).click();
      const reward = page.getByRole("region", { name: "Recompensa de esta venta", exact: true });
      await reward.getByLabel("El cliente confirma usar sus puntos", { exact: true }).check();
      await reward.getByRole("button", { name: "Aplicar a esta venta", exact: true }).click();
      await page.getByRole("radio", { name: "Tarjeta manual", exact: true }).click();
      const redeemedResponse = postResponse("/loyalty/rewards/checkout");
      await page.getByRole("button", { name: /^Cobrar$/ }).click();
      const redeemed = await (await redeemedResponse).json();
      expect(redeemed).toMatchObject({ customer_id: customerId, total_amount: "100.50", loyalty_reward: { points_cost: 8, discount_amount: "25.00" }, items: [{ product_id: product.id }] });
      await page.goto("/loyalty");
      const finalProcess = postResponse("/loyalty/process");
      await page.getByRole("button", { name: "Actualizar movimientos de puntos", exact: true }).click();
      expect((await finalProcess).ok()).toBe(true);
      await card.getByRole("button", { name: "Actualizar puntos", exact: true }).click();
      await expect(card.getByLabel("Tus puntos", { exact: true })).toHaveText("10");
      const ledger = await (await page.request.get(`/api/v1/loyalty/customers/${customerId}`)).json();
      expect(ledger.entries).toHaveLength(3);
      expect(ledger.entries.filter((entry: { kind: string }) => entry.kind === "redemption")).toMatchObject([{ points: -8 }]);
      expect(ledger.entries.filter((entry: { kind: string }) => entry.kind === "accrual").map((entry: { points: number }) => entry.points).sort((a: number, b: number) => a - b)).toEqual([8, 10]);
      const customers = await page.request.get("/api/v1/customers");
      expect((await customers.json()).map((row: { id: string }) => row.id)).toEqual([customerId]);
      const sales = await page.request.get("/api/v1/orders");
      expect((await sales.json()).total).toBe(2);
      expect(await card.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.screenshot({ path: testInfo.outputPath("member-card-redeemed-mobile.png"), fullPage: true });
    } finally { await anonymousContext.close(); }
  });
});
