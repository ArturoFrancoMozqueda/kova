import { type Page, expect, test } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: "Shift Management" })).toBeVisible();
  await expect(page.getByText("No shift is currently open")).toBeVisible();

  await page.getByRole("button", { name: "Open Shift" }).click();
  await expect(page.getByRole("heading", { name: "Open Shift" })).toBeVisible();

  await page.getByLabel("Opening cash amount (optional)").fill("500.00");
  await page.getByRole("button", { name: "Open shift", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Shift opened successfully.");
  await expect(page.getByRole("heading", { name: "Active Shift" })).toBeVisible();
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
  await page.getByRole("button", { name: "Open Shift", exact: true }).click();
  await page.getByRole("button", { name: "Open shift", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Shift opened successfully.");
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
  await expect(page.getByRole("heading", { name: "Active Shift" })).toBeVisible();

  await page.getByRole("button", { name: "Close Shift" }).click();
  await expect(page.getByRole("heading", { name: "Close Shift" })).toBeVisible();

  await page.getByLabel("Actual cash in register").fill("1050.00");
  await page.getByRole("button", { name: "Close shift", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText("Shift closed successfully.");
  await expect(page.getByText("balanced")).toBeVisible();
});

test("staff user without open permission does not see Open Shift button", async ({ page }) => {
  await mockAuth(page, STAFF_SESSION);

  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ json: null }));
  await page.route("**/api/v1/shifts", (route) => route.fulfill({ json: [] }));

  await page.goto("/shifts");
  await expect(page.getByRole("heading", { name: "Shift Management" })).toBeVisible();
  await expect(page.getByText("No shift is currently open")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Shift" })).not.toBeVisible();
});

test("shift view shows load error state and retry button", async ({ page }) => {
  await mockAuth(page);

  await page.route("**/api/v1/shifts/current", (route) => route.fulfill({ status: 500, json: {} }));
  await page.route("**/api/v1/shifts", (route) => route.fulfill({ status: 500, json: {} }));

  await page.goto("/shifts");
  await expect(page.getByRole("alert")).toContainText("Could not load shift data");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
