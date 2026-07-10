import { type Page, expect, test } from "@playwright/test";

async function mockAuthAsOwner(page: Page) {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: "owner@bakery.com", tenant_id: "tenant-1", role: "owner" },
        tenant_id: "tenant-1",
        tenant_name: "Bakery",
      },
    });
  });
}

test("settings receipt logo upload updates the preview", async ({ page }) => {
  await mockAuthAsOwner(page);
  let logoUrl: string | null = null;

  await page.route("**/api/v1/settings/business-profile", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Bakery",
        support_email: null,
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    });
  });
  await page.route("**/api/v1/settings/receipt", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        receipt_business_name: "Bakery",
        footer: null,
        tax_contact_text: null,
        logo_url: logoUrl,
      },
    });
  });
  await page.route("**/api/v1/employees", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/employees/invitations", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        subscription: null,
        access: { status: "trial_active", reason: "trial_active" },
      },
    });
  });
  await page.route("**/api/v1/settings/receipt/logo", async (route) => {
    logoUrl = "/api/v1/settings/receipt/logo/tenant-1?v=123";
    await route.fulfill({ json: { logo_url: logoUrl } });
  });
  await page.route("**/api/v1/settings/receipt/logo/tenant-1?v=123", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });

  await page.goto("/settings/receipt");
  await page.setInputFiles("#receipt-logo-file", {
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  await expect(page.locator('img[alt="Logo del recibo"]').first()).toBeVisible();
  await expect(page.getByText(/logo del recibo actualizado/i)).toBeVisible();
});

test("settings employees explains role permissions before inviting staff", async ({ page }) => {
  await mockAuthAsOwner(page);

  await page.route("**/api/v1/settings/business-profile", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Bakery",
        support_email: null,
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    });
  });
  await page.route("**/api/v1/settings/receipt", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        receipt_business_name: "Bakery",
        footer: null,
        tax_contact_text: null,
        logo_url: null,
      },
    });
  });
  await page.route("**/api/v1/employees", async (route) => {
    await route.fulfill({
      json: [
        {
          membership_id: "membership-1",
          email: "cashier@bakery.com",
          role: "cashier",
          is_active: true,
        },
      ],
    });
  });
  await page.route("**/api/v1/employees/invitations", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        subscription: null,
        access: { status: "trial_active", reason: "trial_active" },
      },
    });
  });

  await page.goto("/settings/employees");

  await expect(page.getByRole("heading", { name: /empleados/i })).toBeVisible();
  await expect(page.getByText(/control total/i)).toBeVisible();
  await expect(page.getByText(/opera el negocio/i)).toBeVisible();
  await expect(page.getByText(/uso diario/i).first()).toBeVisible();
  await expect(page.getByText("cashier@bakery.com")).toBeVisible();
  await expect(page.getByLabel("Correo del empleado")).toBeVisible();
  await expect(page.getByLabel("Rol")).toBeVisible();
});

test("settings employees invite role change and deactivate work at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthAsOwner(page);

  let employees = [
    {
      membership_id: "membership-1",
      user_id: "employee-1",
      email: "cashier@bakery.com",
      role: "cashier",
      is_active: true,
      created_at: "2026-05-20T10:00:00Z",
    },
  ];
  let invitations: Array<{
    id: string;
    email: string;
    role: "owner" | "manager" | "cashier";
    status: string;
    created_at: string;
  }> = [];

  await page.route("**/api/v1/settings/business-profile", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Bakery",
        support_email: null,
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    });
  });
  await page.route("**/api/v1/settings/receipt", async (route) => {
    await route.fulfill({
      json: {
        tenant_id: "tenant-1",
        receipt_business_name: "Bakery",
        footer: null,
        tax_contact_text: null,
        logo_url: null,
      },
    });
  });
  await page.route("**/api/v1/employees", async (route) => {
    await route.fulfill({ json: employees });
  });
  await page.route("**/api/v1/employees/invitations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: invitations });
      return;
    }

    const body = JSON.parse(route.request().postData() ?? "{}");
    const invitation = {
      id: "invite-1",
      email: body.email,
      role: body.role,
      status: "pending",
      created_at: "2026-05-20T12:00:00Z",
    };
    invitations = [invitation];
    await route.fulfill({ status: 201, json: invitation });
  });
  await page.route("**/api/v1/employees/membership-1/role**", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    employees = employees.map((employee) =>
      employee.membership_id === "membership-1" ? { ...employee, role: body.role } : employee,
    );
    await route.fulfill({ json: employees[0] });
  });
  await page.route("**/api/v1/employees/membership-1**", async (route) => {
    if (route.request().url().includes("/role")) {
      await route.fallback();
      return;
    }
    employees = employees.map((employee) =>
      employee.membership_id === "membership-1" ? { ...employee, is_active: false } : employee,
    );
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/v1/billing/subscription", async (route) => {
    await route.fulfill({
      json: {
        subscription: null,
        access: { status: "trial_active", reason: "trial_active" },
      },
    });
  });

  await page.goto("/settings/employees");

  await page.getByLabel("Correo del empleado").fill("barista@bakery.com");
  await page.getByLabel("Rol").selectOption("manager");
  await page.getByRole("button", { name: /invitar/i }).click();
  await expect(page.getByText(/invitaci[oó]n de empleado creada/i)).toBeVisible();
  await expect(page.getByText("barista@bakery.com - Gerente - pending")).toBeVisible();

  const employeeRow = page.getByText("cashier@bakery.com").locator("..").locator("..");
  // Role change now confirms before mutating (PLAN-UX-01): the select opens a
  // confirmation dialog and the change applies only after confirming.
  await employeeRow.locator("select").selectOption("manager");
  await page.getByRole("button", { name: /cambiar rol/i }).click();
  await expect(employeeRow.getByText(/opera el negocio/i)).toBeVisible();

  // Deactivate is likewise gated by a confirmation dialog.
  await employeeRow.getByRole("button", { name: /desactivar/i }).click();
  await page.getByRole("button", { name: /desactivar acceso/i }).click();
  await expect(page.getByText(/acceso desactivado/i)).toBeVisible();
  await expect(employeeRow.getByRole("button", { name: /desactivar/i })).toBeDisabled();
});
