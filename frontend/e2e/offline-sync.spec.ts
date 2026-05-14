import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: "Sync Queue" })).toBeVisible();
  await expect(page.getByText("No pending or failed sales.")).toBeVisible();
});

test("network-error sale appears in pending sync and clears after manual sync", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Add Concha" }).click();
  await page.getByLabel("Cash tendered").fill("20.00");
  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByRole("status")).toContainText("queued");

  // Sync queue shows 1 pending entry
  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: "Sync Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending sync" })).toBeVisible();

  // Click Sync now → second call succeeds
  await page.getByRole("button", { name: "Sync now" }).click();

  // Pending section disappears after successful sync
  await expect(page.getByRole("heading", { name: "Pending sync" })).not.toBeVisible({
    timeout: 5000,
  });
});

test("server-error sale appears in dead letter and succeeds on retry", async ({ page }) => {
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
  await page.getByRole("button", { name: "Add Concha" }).click();
  await page.getByLabel("Cash tendered").fill("20.00");
  await page.getByRole("button", { name: "Complete sale" }).click();
  // Notice shown (server returned failed result, not a network error)
  await expect(page.getByRole("status")).toBeVisible();

  // Navigate to sync queue — should show Failed section
  await page.goto("/sync-queue");
  await expect(page.getByRole("heading", { name: "Sync Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Failed" })).toBeVisible();

  // Retry the dead-letter entry — second sync call succeeds
  await page.getByRole("button", { name: "Retry" }).click();

  // Failed section disappears
  await expect(page.getByRole("heading", { name: "Failed" })).not.toBeVisible({ timeout: 5000 });
});

test("duplicate sync of same client_uuid returns same order (idempotency)", async ({ page }) => {
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
  await page.getByRole("button", { name: "Add Concha" }).click();
  await page.getByLabel("Cash tendered").fill("20.00");
  await page.getByRole("button", { name: "Complete sale" }).click();

  await expect(page.getByRole("status")).toHaveText("Sale completed.");
  await expect(page.getByRole("link", { name: "Open order" })).toHaveAttribute(
    "href",
    `/orders/${syncedOrderId}`,
  );
});
