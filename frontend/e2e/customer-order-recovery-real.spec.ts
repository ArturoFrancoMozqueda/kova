import { expect, test, type Page } from "./fixtures";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

function nextWrite(page: Page, path: string, method = "POST") {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}`
    && response.request().method() === method);
}
async function read(page: Page, path: string) {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.ok(), `Lectura local ${path}`).toBe(true);
  return response.json();
}
async function prepare(page: Page, label: string) {
  const response = nextWrite(page, "/auth/signup");
  await createTenantThroughUi(page, label);
  const signup = await (await response).json();
  const session = await read(page, "/auth/session");
  await markFirstUseToursSeen(page, session.tenant_id);
  return page.evaluate(async (token: string) => {
    // Same local-only CSRF/verification setup as the existing real-stack suite.
    // No token, cookie, authentication header or browser storage is exported.
    const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
    if (!csrf || !token) throw new Error("La preparación requiere verificación local de desarrollo.");
    const post = async (path: string, body: object) => {
      const response = await fetch(`/api/v1${path}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Preparación local ${path}: ${response.status}`);
      return response.json();
    };
    await post("/auth/verify", { token });
    const product = await post("/catalog/products", {
      name: "Producto recuperación pedido local", price_amount: "25.00", cost_price: "10.00", track_inventory: true,
    });
    await post(`/inventory/products/${product.id}/adjustments`, { quantity_delta: 2, reason: "Existencias efímeras para probar recuperación" });
    return { productId: product.id as string, name: product.name as string };
  }, signup.dev_verification_token);
}

// Development verification is setup-only and is never retained in a trace.
test.use({ trace: "off" });

test.describe("recuperación de pedidos con API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y stack local desechable");

  for (const width of [390, 1440]) {
    test(`corrige un rechazo por stock sobre el mismo pedido y limita todas las entradas a ${width}px`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(90_000);
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      const product = await prepare(page, `pedido-correccion-${width}`);
      await page.goto("/pedidos/nuevo");
      const add = page.getByRole("button", { name: `Agregar ${product.name}`, exact: true });
      await add.click();
      await add.click();
      await expect(add).toHaveAttribute("aria-disabled", "true");
      await expect(page.getByRole("button", { name: "Agregar una unidad", exact: true })).toBeDisabled();
      // aria-disabled remains discoverable, and its real handler must reject a
      // pointer click too (Playwright's normal click intentionally avoids it).
      await add.click({ force: true });

      // A real concurrent stock change after the draft was loaded makes
      // confirmation fail. No API response is mocked or intercepted here.
      await page.evaluate(async productId => {
        const csrf = document.cookie.split("; ").find(part => part.startsWith("csrf_token="))?.slice("csrf_token=".length);
        if (!csrf) throw new Error("El ajuste local requiere CSRF.");
        const response = await fetch(`/api/v1/inventory/products/${productId}/adjustments`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ quantity_delta: -1, reason: "Cambio concurrente real durante captura local" }),
        });
        if (!response.ok) throw new Error(`Ajuste concurrente: ${response.status}`);
      }, product.productId);
      const created = nextWrite(page, "/customer-orders");
      const confirmation = page.waitForResponse(response => /\/api\/v1\/customer-orders\/[^/]+\/confirm$/.test(new URL(response.url()).pathname));
      await page.getByRole("button", { name: "Guardar y confirmar", exact: true }).click();
      const first = await (await created).json();
      expect(first.items[0].quantity).toBe(2);
      expect((await confirmation).status()).toBe(422);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("heading", { name: `Editar ${first.folio}`, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Quitar una unidad", exact: true }).click();
      const updated = nextWrite(page, `/customer-orders/${first.id}`, "PATCH");
      const confirmed = nextWrite(page, `/customer-orders/${first.id}/confirm`);
      await page.getByRole("button", { name: "Guardar y confirmar", exact: true }).click();
      const update = await updated;
      expect(update.ok()).toBe(true);
      expect(update.request().postDataJSON().items[0]).toMatchObject({ id: first.items[0].id, quantity: 1 });
      expect((await confirmed).ok()).toBe(true);
      await expect(page).toHaveURL(new RegExp(`/pedidos/${first.id}$`));
      expect((await read(page, "/customer-orders")).total).toBe(1);
      expect((await read(page, `/customer-orders/${first.id}`)).status).toBe("confirmed");
      expect((await read(page, "/inventory/stock")).find((row: { product_id: string }) => row.product_id === product.productId))
        .toMatchObject({ stock_on_hand: 1, reserved_quantity: 1, available_quantity: 0 });
      expect((await read(page, "/orders")).total).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`pedido-corregido-${width}.png`), fullPage: true });
    });

    test(`recupera la respuesta perdida después de confirmar sin otro pedido a ${width}px`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      const product = await prepare(page, `pedido-respuesta-perdida-${width}`);
      let firstKey: string | null = null;
      let secondKey: string | null = null;
      let createdCount = 0;
      page.on("request", request => {
        if (new URL(request.url()).pathname === "/api/v1/customer-orders" && request.method() === "POST") createdCount++;
      });
      let responseLost = false;
      await page.route("**/api/v1/customer-orders/*/confirm", async route => {
        if (!responseLost) {
          responseLost = true;
          firstKey = await route.request().headerValue("Idempotency-Key");
          // Induced transport failure only: let the real API commit before
          // losing its response. The second send reaches the real API again.
          const committed = await route.fetch();
          expect(committed.ok()).toBe(true);
          await route.abort("connectionreset");
        } else {
          secondKey = await route.request().headerValue("Idempotency-Key");
          await route.continue();
        }
      });
      await page.goto("/pedidos/nuevo");
      await page.getByRole("button", { name: `Agregar ${product.name}`, exact: true }).click();
      const created = nextWrite(page, "/customer-orders");
      await page.getByRole("button", { name: "Guardar y confirmar", exact: true }).click();
      const order = await (await created).json();
      const recover = page.getByRole("button", { name: "Recuperar resultado del pedido", exact: true });
      await expect(recover).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Nota general", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Guardar y confirmar", exact: true })).toBeDisabled();
      const confirmed = nextWrite(page, `/customer-orders/${order.id}/confirm`);
      await recover.click();
      expect((await confirmed).ok()).toBe(true);
      await expect(page).toHaveURL(new RegExp(`/pedidos/${order.id}$`));
      expect(firstKey).toBeTruthy();
      expect(secondKey).toBe(firstKey);
      expect(createdCount).toBe(1);
      expect((await read(page, "/customer-orders")).total).toBe(1);
      expect((await read(page, "/inventory/stock")).find((row: { product_id: string }) => row.product_id === product.productId))
        .toMatchObject({ stock_on_hand: 2, reserved_quantity: 1, available_quantity: 1 });
      expect((await read(page, "/orders")).total).toBe(0);
    });
  }
});
