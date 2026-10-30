import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import { createTenantThroughUi, integrationEnabled } from "./integration-helpers";

type QueueRow = {
  client_uuid: string;
  status: string;
  attempt_count: number;
  synced_order_id?: string;
};

async function queuedSales(page: Page): Promise<QueueRow[]> {
  return page.evaluate(() => new Promise<QueueRow[]>((resolve, reject) => {
    const opening = indexedDB.open("pos_offline");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction("offline_sales", "readonly")
        .objectStore("offline_sales").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        db.close();
        resolve(request.result.map((row: QueueRow) => ({
          client_uuid: row.client_uuid,
          status: row.status,
          attempt_count: row.attempt_count,
          synced_order_id: row.synced_order_id,
        })));
      };
    };
  }));
}

test.describe("venta sin conexión con API, PostgreSQL y RLS reales", () => {
  test.skip(!integrationEnabled(), "Requiere KOVA_INTEGRATION=1 y el stack local desechable");

  for (const width of [390, 1440]) {
    test(`recarga offline y respuesta perdida conservan una sola venta a ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      const network: Array<{ path: string; status: number }> = [];
      page.on("response", response => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith("/api/v1/")) network.push({ path, status: response.status() });
      });
      await page.setViewportSize({ width, height: 900 });
      await createTenantThroughUi(page, `offline-real-${width}`);
      const session = await (await page.request.get("/api/v1/auth/session")).json();
      await markFirstUseToursSeen(page, session.tenant_id);

      const product = await page.evaluate(async () => {
        const csrf = document.cookie.split("; ")
          .find((item) => item.startsWith("csrf_token="))?.slice("csrf_token=".length);
        if (!csrf) throw new Error("Se requiere CSRF real para preparar el negocio local");
        const post = async (url: string, body: object) => {
          const response = await fetch(url, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf),
              "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error(`Preparación real ${url}: ${response.status}`);
          return response.json();
        };
        const created = await post("/api/v1/catalog/products", {
          name: "Producto offline real", price_amount: "37.50", track_inventory: true,
        });
        await post(`/api/v1/inventory/products/${created.id}/adjustments`, {
          quantity_delta: 5, reason: "Existencias para aceptación local offline",
        });
        return created as { id: string; name: string };
      });

      await page.goto("/shifts");
      await page.getByRole("button", { name: /^abrir turno$/i }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/efectivo inicial/i).fill("100.00");
      await dialog.getByRole("button", { name: /^abrir turno$/i }).click();
      await expect(dialog).toBeHidden();
      await page.goto("/register");
      await expect(page.getByRole("button", { name: `Agregar ${product.name}` })).toBeVisible();

      // Prepare the actual PWA and persisted server authorization; never seed
      // IndexedDB or fabricate an authenticated/offline session in this test.
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => navigator.serviceWorker
            .addEventListener("controllerchange", () => resolve(), { once: true }));
        }
      });
      await page.context().setOffline(true);
      await page.getByRole("button", { name: `Agregar ${product.name}` }).click();
      await page.getByLabel(/efectivo recibido/i).fill("40.00");
      await page.getByRole("button", { name: /^cobrar$/i }).click();
      const savedReceipt = width < 768
        ? page.getByRole("dialog", { name: "Venta guardada en este dispositivo", exact: true })
        : page.getByRole("paragraph").filter({ hasText: "Venta guardada en este dispositivo" });
      await expect(savedReceipt).toBeVisible();
      await expect.poll(() => queuedSales(page))
        .toMatchObject([{ status: "pending", attempt_count: 0 }]);
      const [queued] = await queuedSales(page);

      await page.reload();
      await expect(page.getByRole("button", { name: `Agregar ${product.name}` })).toBeVisible();
      expect(await queuedSales(page))
        .toMatchObject([{ client_uuid: queued.client_uuid, status: "pending", attempt_count: 0 }]);

      // Inject loss of a real successful response: the API commits normally.
      // The next browser retry must reuse the same sale and cannot charge or
      // decrement stock twice. No API response is mocked or manufactured.
      let lostResponse = false;
      let syncRequests = 0;
      await page.route("**/api/v1/sync/offline-sales", async (route) => {
        syncRequests += 1;
        if (!lostResponse) {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          lostResponse = true;
          await route.abort("failed");
        } else {
          await route.continue();
        }
      });
      await page.context().setOffline(false);
      try {
        await expect.poll(() => queuedSales(page), { timeout: 30_000 })
          .toMatchObject([{ client_uuid: queued.client_uuid, status: "synced" }]);
      } finally {
        await testInfo.attach("network-statuses", {
          body: JSON.stringify({ network, syncRequests, lostResponse, queue: await queuedSales(page) }),
          contentType: "application/json",
        });
      }
      expect(lostResponse).toBe(true);
      expect(syncRequests).toBeGreaterThanOrEqual(2);

      const [synced] = await queuedSales(page);
      const orderResponse = await page.request.get(`/api/v1/orders/${synced.synced_order_id}`);
      expect(orderResponse.ok()).toBe(true);
      const order = await orderResponse.json();
      expect(order).toMatchObject({ status: "completed", total_amount: "37.50" });
      expect(order.payments).toHaveLength(1);
      expect(order.payments[0]).toMatchObject({ change_due_amount: "2.50" });
      const ordersResponse = await page.request.get("/api/v1/orders");
      expect(ordersResponse.ok()).toBe(true);
      const orders = await ordersResponse.json();
      expect(orders.total).toBe(1);
      expect(orders.items[0].id).toBe(synced.synced_order_id);
      const stockResponse = await page.request.get("/api/v1/inventory/stock");
      expect(stockResponse.ok()).toBe(true);
      const stock = await stockResponse.json();
      expect(stock.find((item: { product_id: string }) => item.product_id === product.id)
        .stock_on_hand).toBe(4);
      await expect(page.getByText(/Modo sin conexión: mostrando el catálogo guardado/)).toBeHidden();
      await expect(page.getByText(/No pudimos comprobar el turno/)).toBeHidden();
      await page.getByRole("button", { name: `Agregar ${product.name}` }).click();
      await expect(page.getByLabel(/efectivo recibido/i)).toBeEnabled();
      await page.getByLabel(/efectivo recibido/i).fill("40.00");
      await expect(page.getByRole("button", { name: /^cobrar$/i })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`offline-restored-${width}.png`),
        fullPage: true, animations: "disabled",
      });
      await testInfo.attach("offline-real-acceptance", {
        body: JSON.stringify({ width, syncRequests, orders: 1, payments: 1, total: "37.50", stock: 4 }),
        contentType: "application/json",
      });
    });
  }
});
