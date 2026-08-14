import { type Page, expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

async function mockOwner(page: Page) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ json: {
      authenticated: true,
      user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
      tenant_id: "tenant-1",
      tenant_name: "Panadería Luna",
      feature_flags: { margin_reports: true },
    } });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({ json: { status: "active", access_status: "active", trial_ends_at: null, grace_ends_at: null, current_period_end: null, cancel_at_period_end: false } });
  });
}

test("owner registers an operating expense and sees the exact total", async ({ page }) => {
  await markFirstUseToursSeen(page);
  await mockOwner(page);
  const expenses: Array<Record<string, unknown>> = [];
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/expenses**", async (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      expenses.push({
        id: "expense-1",
        ...posted,
        created_by_user_id: "user-1",
        created_at: "2026-07-18T00:00:00Z",
        updated_at: "2026-07-18T00:00:00Z",
      });
      await route.fulfill({ status: 201, json: expenses[0] });
      return;
    }
    await route.fulfill({ json: expenses });
  });

  await page.goto("/expenses");
  await page.getByRole("button", { name: /registrar gasto/i }).first().click();
  await page.getByLabel("Categoría").selectOption("renta");
  await page.getByLabel("Monto").fill("1250.00");
  await page.getByLabel("Fecha del gasto").fill("2026-07-18");
  await page.getByLabel("Nota").fill("Renta del local");
  await page.getByRole("button", { name: /guardar gasto/i }).click();

  await expect(page.getByText("Gasto registrado.")).toBeVisible();
  await expect(page.getByText("Renta", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,250.00").first()).toBeVisible();
  expect(posted).toEqual({
    category: "renta",
    amount: "1250.00",
    expense_date: "2026-07-18",
    note: "Renta del local",
  });
});
