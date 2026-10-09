import { expect, test, type Page } from "./fixtures";
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

async function mockOpenShift(page: Page) {
  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: { id: "shift-1", tenant_id: "tenant-1", status: "open" } }),
  );
}

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
  await mockOpenShift(page);
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
  await expect(page.getByRole("heading", { name: /^pendientes$/i })).toBeVisible();
});

test("a login in another tab suspends the stale tenant UI until it is revalidated", async ({ page }) => {
  await markFirstUseToursSeen(page);
  let pageAProbeCount = 0;
  let releasePageAProbe!: () => void;
  const pageAProbeGate = new Promise<void>((resolve) => { releasePageAProbe = resolve; });

  await page.route("**/api/v1/auth/session", async (route) => {
    pageAProbeCount += 1;
    if (pageAProbeCount === 1) return route.fulfill({ json: CASHIER_SESSION });
    await pageAProbeGate;
    return route.fulfill({
      json: {
        ...CASHIER_SESSION,
        user: {
          ...CASHIER_SESSION.user,
          id: "user-2",
          email: "cashier-b@bakery.com",
          tenant_id: "tenant-2",
        },
        tenant_id: "tenant-2",
        tenant_name: "Bakery B",
      },
    });
  });
  await page.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: CATALOG }));
  await page.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await mockOpenShift(page);

  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await expect(page.getByText("Concha", { exact: true }).last()).toBeVisible();

  const otherTab = await page.context().newPage();
  await otherTab.route("**/api/v1/auth/login", (route) => route.fulfill({ json: { message: "ok" } }));
  await otherTab.route("**/api/v1/auth/session", (route) => route.fulfill({
    json: {
      ...CASHIER_SESSION,
      user: {
        ...CASHIER_SESSION.user,
        id: "user-2",
        email: "cashier-b@bakery.com",
        tenant_id: "tenant-2",
      },
      tenant_id: "tenant-2",
      tenant_name: "Bakery B",
    },
  }));
  await otherTab.route("**/api/v1/catalog/products", (route) => route.fulfill({ json: CATALOG }));
  await otherTab.route("**/api/v1/catalog/categories", (route) => route.fulfill({ json: [] }));
  await mockOpenShift(otherTab);

  await otherTab.goto("/login");
  await otherTab.getByLabel("Correo").fill("cashier-b@bakery.com");
  await otherTab.getByLabel("Contraseña").fill("S3cur3pass!");
  await otherTab.getByRole("button", { name: "Iniciar sesión", exact: true }).click();

  await expect.poll(() => pageAProbeCount).toBe(2);
  await expect(page.getByRole("button", { name: "Agregar Concha" })).not.toBeVisible();
  releasePageAProbe();

  await expect(page.getByText("Bakery B", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Concha", { exact: true })).toHaveCount(1);
  await otherTab.close();
});

test("network-error sale remains recoverable and clears on retry", async ({
  page,
}) => {
  await markFirstUseToursSeen(page);
  await mockOpenShift(page);
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
  const sentSales: Array<Record<string, unknown> & { client_uuid: string }> = [];
  const readStoredSale = () => page.evaluate((clientUuid) => new Promise<{
    status: string;
    lease_id?: string;
    sync_owner?: string;
    attempt_count: number;
    last_error?: string;
    synced_order_id?: string;
  } | undefined>((resolve, reject) => {
    const opening = indexedDB.open("pos_offline");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction("offline_sales", "readonly").objectStore("offline_sales").get(clientUuid);
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        const row = request.result;
        db.close();
        resolve(row ? {
          status: row.status,
          lease_id: row.lease_id,
          sync_owner: row.sync_owner,
          attempt_count: row.attempt_count,
          last_error: row.last_error,
          synced_order_id: row.synced_order_id,
        } : undefined);
      };
    };
  }), sentSales[0].client_uuid);

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    syncCallCount += 1;
    const body = route.request().postDataJSON() as {
      sales: Array<Record<string, unknown> & { client_uuid: string }>;
    };
    sentSales.push(body.sales[0]);
    capturedClientUuid = body.sales[0].client_uuid;

    if (syncCallCount === 1) {
      await route.abort(); // simulate network down
    } else {
      await route.fulfill({ json: syncSuccess(capturedClientUuid, "10000000-0000-4000-8000-000000000007") });
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
  await expect.poll(() => syncCallCount).toBeGreaterThanOrEqual(1);

  // The receipt appears before the rejected fetch has released its lease.
  // A full navigation at that point interrupts the rollback and leaves a
  // valid crash lease. Wait for the durable recovery state before reloading.
  await expect.poll(async () => {
    const row = await readStoredSale();
    if (!row || row.lease_id != null || row.sync_owner != null) return false;
    return (row.status === "pending" && row.attempt_count >= 1 && Boolean(row.last_error))
      || (row.status === "synced" && syncCallCount >= 2);
  }).toBe(true);

  // Open the queue while the worker is eligible to retry in the background.
  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /cola de sincronizaci[óo]n/i })).toBeVisible();

  // The first worker may still be unwinding when the queue view appears. Retry
  // the explicit action until that lease is released, or until the scheduled
  // background retry has already converged.
  const pendingHeading = page.getByRole("heading", { name: /^pendientes$/i });
  const syncNow = page.getByRole("button", { name: /sincronizar ahora/i });
  await expect.poll(async () => {
    if (syncCallCount < 2 && await syncNow.isVisible()) {
      await syncNow.click({ timeout: 1_000 }).catch(() => undefined);
    }
    return syncCallCount;
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // Either recovery path must reuse the queued sale and clear it.
  expect(sentSales[1]).toEqual(sentSales[0]);
  await expect.poll(readStoredSale).toMatchObject({
    status: "synced",
    lease_id: undefined,
    sync_owner: undefined,
    synced_order_id: "10000000-0000-4000-8000-000000000007",
  });
  await expect(pendingHeading).not.toBeVisible({
    timeout: 5000,
  });
});

test("server-error sale appears in dead letter and succeeds on retry", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockOpenShift(page);
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
  const sentSales: Array<Record<string, unknown> & { client_uuid: string }> = [];
  const readStoredSales = () => page.evaluate(() => new Promise<Array<{
    client_uuid: string;
    status: string;
    synced_order_id?: string;
  }>>((resolve, reject) => {
    const opening = indexedDB.open("pos_offline");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction("offline_sales", "readonly").objectStore("offline_sales").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        db.close();
        resolve(request.result.map((row) => ({
          client_uuid: row.client_uuid,
          status: row.status,
          synced_order_id: row.synced_order_id,
        })));
      };
    };
  }));

  await page.route("**/api/v1/sync/offline-sales", async (route) => {
    syncCallCount += 1;
    const body = route.request().postDataJSON() as {
      sales: Array<Record<string, unknown> & { client_uuid: string }>;
    };
    sentSales.push(body.sales[0]);
    capturedClientUuid ??= body.sales[0].client_uuid;

    if (syncCallCount === 1) {
      // Server rejects the sale (e.g., invalid product)
      await route.fulfill({
        json: syncFailure(capturedClientUuid, "Product not found"),
      });
    } else {
      await route.fulfill({ json: syncSuccess(body.sales[0].client_uuid, "10000000-0000-4000-8000-000000000008") });
    }
  });

  // Submit sale — server returns per-sale failure → dead letter
  await page.goto("/register");
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByLabel(/efectivo recibido/i).fill("20.00");
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  // The payment remains a durable queued sale. Recovery must retry that UUID,
  // rather than restore a cart that can record the same paid sale again.
  await expect(page.getByRole("alert")).toHaveText(/la venta sigue guardada en este dispositivo y requiere revisión/i);
  await expect(page.getByRole("paragraph").filter({ hasText: "Venta guardada en este dispositivo" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ver cola/i }).first()).toHaveAttribute("href", "/sync-queue");
  await expect.poll(readStoredSales).toEqual([{
    client_uuid: capturedClientUuid,
    status: "failed",
    synced_order_id: undefined,
  }]);
  await page.getByRole("button", { name: /nueva venta/i }).first().click();
  await expect(page.getByRole("button", { name: "Quitar Concha" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^cobrar$/i })).toBeDisabled();
  expect(syncCallCount).toBe(1);

  // Navigate to sync queue — should show Failed section
  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /cola de sincronizaci[óo]n/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^fallidas$/i })).toBeVisible();

  // Retry the dead-letter entry — second sync call succeeds
  await page.getByRole("button", { name: /reintentar/i }).click();

  // Failed section disappears
  await expect(page.getByRole("heading", { name: /^fallidas$/i })).not.toBeVisible({ timeout: 5000 });
  await expect.poll(() => syncCallCount).toBe(2);
  expect(sentSales[1]).toEqual(sentSales[0]);
  await expect.poll(readStoredSales).toEqual([{
    client_uuid: capturedClientUuid,
    status: "synced",
    synced_order_id: "10000000-0000-4000-8000-000000000008",
  }]);
});

test("cold offline: register renders catalog from IndexedDB cache and queues a sale", async ({
  page,
}) => {
  await markFirstUseToursSeen(page);
  let online = true;
  await page.route("**/api/v1/auth/session", (route) =>
    online ? route.fulfill({ json: CASHIER_SESSION }) : route.abort("internetdisconnected"),
  );

  // Single mutable flag flips auth/catalog/categories/sync to a hard network
  // failure, including the cold-start session probe.
  await page.route("**/api/v1/catalog/products", (route) =>
    online ? route.fulfill({ json: CATALOG }) : route.abort(),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    online ? route.fulfill({ json: [] }) : route.abort(),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) =>
    online
      ? route.fulfill({ json: syncSuccess("ignored", "10000000-0000-4000-8000-000000000009") })
      : route.abort(),
  );

  // Phase 1 — online: the register loads and caches the catalog to IndexedDB.
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();

  // Preview mode exercises the generated service worker too: wait until it
  // controls this page, then remove all browser networking before reloading.
  // Dev mode has SW disabled, so it still verifies the auth probe itself fails.
  if (process.env.PLAYWRIGHT_USE_PREVIEW === "1") {
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
      await page.reload();
      await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();
    }
    await page.context().setOffline(true);
  }

  // Phase 2 — go fully offline and reload from a cold start.
  online = false;
  await page.reload();

  // The register must render from the cache, not the error card.
  await expect(page.getByText(/modo local seguro/i)).toBeVisible();
  await expect(page.getByText(/modo sin conexi[óo]n/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar Concha" })).toBeVisible();

  // A sale can still be rung and lands in the offline queue.
  await page.getByRole("button", { name: "Agregar Concha" }).click();
  await page.getByRole("radio", { name: /transferencia/i }).click();
  await page.getByRole("button", { name: /^cobrar$/i }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Venta guardada en este dispositivo" }),
  ).toBeVisible();
  await expect(page.getByText(/pendiente de sincronizar/i).first()).toBeVisible();

  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: /^pendientes$/i })).toBeVisible();
});

test("offline sale exposes a printable local receipt before synchronization", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page);
  await mockOpenShift(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/sync/offline-sales", (route) =>
    route.abort("internetdisconnected"),
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
  await mockOpenShift(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: CASHIER_SESSION }),
  );
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({ json: CATALOG }),
  );
  await page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: [] }),
  );

  const syncedOrderId = "10000000-0000-4000-8000-000000000010";

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
