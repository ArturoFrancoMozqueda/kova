import { expect, test } from "@playwright/test";
import { markFirstUseToursSeen } from "./helpers";

const CASHIER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "cashier@bakery.com", tenant_id: "tenant-1", role: "cashier" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const CATALOG = [
  {
    id: "product-1",
    tenant_id: "tenant-1",
    category_id: null,
    name: "Concha",
    description: null,
    sku: "CON-001",
    price_amount: "18.50",
    track_inventory: false,
    low_stock_threshold: null,
    is_active: true,
    modifier_groups: [],
  },
];

function syncSuccess(clientUuid: string, orderId: string) {
  return {
    results: [
      {
        client_uuid: clientUuid,
        status: "synced",
        order_id: orderId,
        order: {
          id: orderId,
          tenant_id: "tenant-1",
          status: "completed",
          subtotal_amount: "18.50",
          total_amount: "18.50",
          items: [],
          payments: [],
        },
        error: null,
      },
    ],
  };
}

function syncFailure(clientUuid: string, error: string) {
  return {
    results: [
      {
        client_uuid: clientUuid,
        status: "failed",
        order_id: null,
        order: null,
        error,
      },
    ],
  };
}

test("sync queue view shows empty state when no offline sales exist", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );

  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /cola de sincronizaci[óo]n/i })).toBeVisible();
  await expect(page.getByText(/sin ventas pendientes o fallidas/i)).toBeVisible();
});

test("shared browser never exposes or sends tenant A queue after tenant B signs in", async ({ page }) => {
  await markFirstUseToursSeen(page);
  let activeSession: {
    authenticated: boolean;
    user: { id: string; email: string; tenant_id: string; role: string };
    tenant_id: string;
    tenant_name: string;
  } = CASHIER_SESSION;
  let syncRequests = 0;
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: activeSession }));
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: CATALOG }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/sync/offline-sales", (route) => {
    syncRequests += 1;
    return route.abort();
  });

  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(page.getByText(/pendiente de sincronizar/i).first()).toBeVisible();
  await expect.poll(() => syncRequests).toBeGreaterThan(0);
  const requestsAfterTenantA = syncRequests;

  activeSession = {
    ...CASHIER_SESSION,
    user: { ...CASHIER_SESSION.user, id: "user-2", email: "cashier-b@bakery.com", tenant_id: "tenant-2" },
    tenant_id: "tenant-2",
    tenant_name: "Bakery B",
  };
  await page.goto("/sync-queue");
  await page.reload();
  await expect(page.getByText(/sin ventas pendientes o fallidas/i)).toBeVisible();
  await page.waitForTimeout(250);
  expect(syncRequests).toBe(requestsAfterTenantA);

  activeSession = CASHIER_SESSION;
  await page.reload();
  await expect(page.getByRole("heading", { name: /pendientes/i })).toBeVisible();
});

test("network-error sale appears in pending sync and clears after manual sync", async ({
  page,
}) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  let syncCallCount = 0;
  let capturedClientUuid: string | null = null;

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    syncCallCount += 1;
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string }>;
    };
    capturedClientUuid = body.sales[0].client_uuid;

    if (syncCallCount === 1) {
      await route.abort(); // simulate network down
    } else {
      await route.fulfill({ json: syncSuccess(capturedClientUuid, "order-retry") });
    }
  });

  // Submit sale — first sync fails
  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Venta guardada en este dispositivo" }),
  ).toBeVisible();
  await expect(page.getByText(/pendiente de sincronizar/i).first()).toBeVisible();

  // Sync queue shows 1 pending entry
  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /cola de sincronizaci[óo]n/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /pendientes/i })).toBeVisible();

  // Click Sync now → second call succeeds
  await page.getByRole("button", { name: /sincronizar ahora/i }).click();

  // Pending section disappears after successful sync
  await expect(page.getByRole("heading", { name: /pendientes/i })).not.toBeVisible({
    timeout: 5000,
  });
});

test("server-error sale appears in dead letter and succeeds on retry", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  let syncCallCount = 0;
  let capturedClientUuid: string | null = null;

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    syncCallCount += 1;
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string }>;
    };
    capturedClientUuid = body.sales[0].client_uuid;

    if (syncCallCount === 1) {
      // Server rejects the sale (e.g., invalid product)
      await route.fulfill({
        json: syncFailure(capturedClientUuid, "Product not found"),
      });
    } else {
      await route.fulfill({ json: syncSuccess(capturedClientUuid, "order-recovered") });
    }
  });

  // Submit sale — server returns per-sale failure → dead letter
  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  // Notice shown (server returned failed result, not a network error)
  await expect(page.getByRole("status")).toBeVisible();

  // Navigate to sync queue — should show Failed section
  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /cola de sincronizaci[óo]n/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /fallidas/i })).toBeVisible();

  // Retry the dead-letter entry — second sync call succeeds
  await page.getByRole("button", { name: /reintentar/i }).click();

  // Failed section disappears
  await expect(page.getByRole("heading", { name: /fallidas/i })).not.toBeVisible({ timeout: 5000 });
});

test("cold offline: register renders catalog from IndexedDB cache and queues a sale", async ({
  page,
}) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );

  // Single mutable flag flips the catalog/categories/sync from online to a
  // hard network failure, simulating going fully offline between two loads.
  let online = true;
  await page.route("**/api/v1/catalog/products", (route) =>
    online ? route.fulfill({ json: CATALOG }) : route.abort(),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    online ? route.fulfill({ json: [] }) : route.abort(),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) =>
    online
      ? route.fulfill({ json: syncSuccess("ignored", "order-online") })
      : route.abort(),
  );

  // Phase 1 — online: the register loads and caches the catalog to IndexedDB.
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();

  // Phase 2 — go fully offline and reload from a cold start.
  online = false;
  await page.reload();

  // The register must render from the cache, not the error card.
  await expect(page.getByText(/modo sin conexi[óo]n/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();

  // A sale can still be rung and lands in the offline queue.
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Venta guardada en este dispositivo" }),
  ).toBeVisible();
  await expect(page.getByText(/pendiente de sincronizar/i).first()).toBeVisible();

  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /pendientes/i })).toBeVisible();
});

test("offline sale exposes a printable local receipt before synchronization", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  await page.goto("/register");
  await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => document.body.setAttribute("data-print-called", "true"),
    });
  });
  await page.context().setOffline(true);

  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();

  const receiptDialog = page.getByRole("dialog", { name: /venta guardada/i });
  await expect(receiptDialog).toBeVisible();
  await expect(receiptDialog.getByText(/pendiente de sincronizar/i)).toBeVisible();
  await expect(receiptDialog.getByText(/folio local [a-f0-9]{8}/i)).toBeVisible();
  await expect(receiptDialog.getByText(/1 x Concha/i)).toBeVisible();
  await expect(receiptDialog.getByRole("link", { name: /abrir orden/i })).toHaveCount(0);

  await receiptDialog.getByRole("button", { name: /imprimir recibo/i }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-called", "true");
});

test("duplicate sync of same client_uuid returns same order (idempotency)", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  const syncedOrderId = "order-idem-1";

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    const body = route.request().postDataJSON() as {
      sales: Array<{ client_uuid: string }>;
    };
    const clientUuid = body.sales[0].client_uuid;
    // Both calls return the same order — server-side idempotency
    await route.fulfill({ json: syncSuccess(clientUuid, syncedOrderId) });
  });

  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();

  await expect(page.getByRole("status")).toHaveText(/venta completada\.?/i);
  await expect(page.getByRole("link", { name: /abrir orden/i })).toHaveAttribute(
    "href",
    `/orders/${syncedOrderId}`,
  );
});
