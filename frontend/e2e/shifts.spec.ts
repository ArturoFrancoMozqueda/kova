import { type Page, expect, test } from "./fixtures";

const OWNER_SESSION = {
  authenticated: true,
  user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

const STAFF_SESSION = {
  authenticated: true,
  user: { id: "user-2", email: "staff@bakery.com", tenant_id: "tenant-1", role: "staff" },
  tenant_id: "tenant-1",
  tenant_name: "Bakery",
};

async function mockAuth(page: Page, session = OWNER_SESSION) {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ json: session }));
}

function makeOpenShift(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    tenant_id: "tenant-1",
    status: "open",
    opened_at: "2026-05-12T10:00:00Z",
    closed_at: null,
    opening_cash_amount: "500.00",
    expected_cash_amount: "1050.00",
    actual_cash_amount: null,
    reconciliation_status: null,
    movements: [],
    ...overrides,
  };
}

test("owner opens a shift with opening cash", async ({ page }) => {
  await mockAuth(page);

  let shiftCreated = false;

  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: shiftCreated ? makeOpenShift() : null }),
  );
  await page.route("**/api/v1/shifts", async (route) => {
    if (route.request().method() === "POST") {
      shiftCreated = true;
      await route.fulfill({ status: 201, json: makeOpenShift() });
    } else {
      await route.fulfill({ json: [] });
    }
  });

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: /^turnos$/i })).toBeVisible();
  await expect(page.getByText(/no hay turno abierto/i)).toBeVisible();

  await page.getByRole("button", { name: "Abrir turno", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Abrir turno", exact: true })).toBeVisible();

  await page.getByLabel(/efectivo inicial \(opcional\)/i).fill("500.00");
  await page.locator("form").getByRole("button", { name: "Abrir turno", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(/turno abierto correctamente/i);
  await expect(page.getByRole("heading", { name: /turno activo/i })).toBeVisible();
});

test("owner opens a shift without opening cash", async ({ page }) => {
  await mockAuth(page);

  let shiftCreated = false;

  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({
      json: shiftCreated ? makeOpenShift({ opening_cash_amount: null }) : null,
    }),
  );
  await page.route("**/api/v1/shifts", async (route) => {
    if (route.request().method() === "POST") {
      shiftCreated = true;
      await route.fulfill({ status: 201, json: makeOpenShift({ opening_cash_amount: null }) });
    } else {
      await route.fulfill({ json: [] });
    }
  });

  await page.goto("/shifts");
  await page.getByRole("button", { name: "Abrir turno", exact: true }).click();
  await page.locator("form").getByRole("button", { name: "Abrir turno", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(/turno abierto correctamente/i);
});

test("open shift expected cash uses backend total that includes cash sales", async ({ page }) => {
  await mockAuth(page);

  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({
      json: makeOpenShift({
        opening_cash_amount: "500.00",
        expected_cash_amount: "532.00",
        movements: [],
      }),
    }),
  );
  await page.route("**/api/v1/shifts", (route) => route.fulfill({ json: [] }));

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: /turno activo/i })).toBeVisible();
  await expect(page.getByText("Efectivo esperado")).toBeVisible();
  await expect(page.getByText("$532.00")).toBeVisible();
});

test("owner closes a shift and sees reconciliation result", async ({ page }) => {
  await mockAuth(page);

  const openShift = makeOpenShift();
  const closedShift = {
    ...openShift,
    status: "closed",
    closed_at: "2026-05-12T18:00:00Z",
    actual_cash_amount: "1050.00",
    reconciliation_status: "balanced",
  };

  let isClosed = false;

  await page.route("**/api/v1/shifts/current", (route) =>
    route.fulfill({ json: isClosed ? null : openShift }),
  );
  await page.route("**/api/v1/shifts", (route) =>
    route.fulfill({ json: isClosed ? [closedShift] : [] }),
  );
  await page.route("**/api/v1/shifts/shift-1/close", async (route) => {
    isClosed = true;
    await route.fulfill({ json: closedShift });
  });

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: /turno activo/i })).toBeVisible();

  await page.getByRole("button", { name: "Cerrar turno", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cerrar turno", exact: true })).toBeVisible();

  await page.getByLabel(/efectivo real en caja/i).fill("1050.00");
  await page.locator("form").getByRole("button", { name: "Cerrar turno", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(/turno cerrado correctamente/i);
  await expect(page.getByRole("table").getByText(/caja cuadrada/i)).toBeVisible();
});

test("staff user without open permission does not see Open Shift button", async ({ page }) => {
  await mockAuth(page, STAFF_SESSION);

  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: null }));
  await page.route("**/api/v1/shifts", (route) => route.fulfill({ json: [] }));

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: /^turnos$/i })).toBeVisible();
  await expect(page.getByText(/no hay turno abierto/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir turno", exact: true })).not.toBeVisible();
});

test("shift view shows load error state and retry button", async ({ page }) => {
  await mockAuth(page);

  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ status: 500, json: {} }));
  await page.route("**/api/v1/shifts", (route) => route.fulfill({ status: 500, json: {} }));

  await page.goto("/shifts");
  await expect(page.getByRole("alert")).toContainText(/no se pudieron cargar los turnos/i);
  await expect(page.getByRole("button", { name: /reintentar/i })).toBeVisible();
});
