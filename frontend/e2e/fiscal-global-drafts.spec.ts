import { type Page, expect, test } from "./fixtures";

const settings = {
  frequency: "monthly",
  weekly_close_day: 7,
  monthly_close_day: 31,
  auto_close_enabled: false,
  timezone: "America/Mexico_City",
  scheduler_status: "active",
};

const preview = {
  frequency: "monthly",
  period_start: "2024-02-01",
  period_end: "2024-02-29",
  timezone: "America/Mexico_City",
  document_kind: "operational_draft",
  fiscal_status: "not_issued",
  gross_amount: "232.00",
  discount_total_amount: "0.00",
  tax_total_amount: "32.00",
  total_amount: "232.00",
  refund_total_amount: "18.00",
  net_total_amount: "214.00",
  order_count: 2,
  excluded_individually_confirmed_count: 1,
};

const closedBatch = {
  ...preview,
  id: "batch-1",
  status: "closed",
  order_ids: ["order-1", "order-2"],
  closed_at: "2024-03-01T06:00:00Z",
};

async function mockSettingsShell(
  page: Page,
  { role = "owner", enabled = true }: { role?: string; enabled?: boolean } = {},
) {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: { id: "user-1", email: `${role}@kova.test`, tenant_id: "tenant-1", role },
        tenant_id: "tenant-1",
        tenant_name: "Kova Test",
        feature_flags: { fiscal_global_drafts: enabled },
      },
    }),
  );
  await page.route("**/api/v1/settings/business-profile", (route) =>
    route.fulfill({
      json: {
        tenant_id: "tenant-1",
        public_name: "Kova Test",
        support_email: null,
        support_phone: null,
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
      },
    }),
  );
  await page.route("**/api/v1/settings/receipt", (route) =>
    route.fulfill({
      json: {
        tenant_id: "tenant-1",
        receipt_business_name: "Kova Test",
        footer: null,
        tax_contact_text: null,
        logo_url: null,
        paper_width_mm: 80,
      },
    }),
  );
  await page.route("**/api/v1/employees", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/employees/invitations", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/account/deletion**", (route) =>
    route.fulfill({ json: { status: "none", requested_at: null, purge_after: null } }),
  );
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({
      json: { subscription: null, access: { status: "trial_active", reason: "trial_active" } },
    }),
  );
}

async function mockFiscalReadRoutes(page: Page, batches: typeof closedBatch[] = []) {
  await page.route("**/api/v1/fiscal/global-drafts/settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      Object.assign(settings, body);
    }
    await route.fulfill({ json: settings });
  });
  await page.route("**/api/v1/fiscal/global-drafts/batches", (route) =>
    route.fulfill({ json: { items: batches, total: batches.length } }),
  );
  await page.route("**/api/v1/fiscal/global-drafts/preview**", (route) =>
    route.fulfill({ json: preview }),
  );
}

test("owner configures, previews and closes an internal period draft", async ({ page }) => {
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page);

  let closeKey = "";
  await page.route("**/api/v1/fiscal/global-drafts/close", async (route) => {
    closeKey = route.request().headers()["idempotency-key"] ?? "";
    expect(JSON.parse(route.request().postData() ?? "{}")).toEqual({ period_end: "2024-02-29" });
    await route.fulfill({
      status: 201,
      json: {
        ...preview,
        id: "batch-1",
        status: "closed",
        order_ids: ["order-1", "order-2"],
        closed_at: "2024-03-01T06:00:00Z",
      },
    });
  });

  await page.goto("/settings/fiscal");
  await expect(page.getByRole("heading", { name: "Preparación por periodo" })).toBeVisible();
  await page.getByRole("checkbox", { name: /preparar automáticamente/i }).check();
  await page.getByRole("button", { name: "Guardar preparación" }).click();
  await expect(page.getByText("Preparación por periodo guardada.")).toBeVisible();

  await page.getByLabel("Fecha de cierre").fill("2024-02-29");
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  await expect(page.getByText("Vista previa lista")).toBeVisible();
  await expect(page.getByText(/2 ventas incluidas.*1 excluida/i)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar periodo" }).click();
  await page.getByRole("button", { name: "Guardar borrador interno" }).click();
  await expect(page.getByText("Borrador interno guardado.")).toBeVisible();
  expect(closeKey).not.toBe("");

  const body = await page.locator("body").innerText();
  expect(body).toMatch(/borrador interno/i);
  expect(body).toMatch(/recibo operativo/i);
  expect(body).not.toMatch(/CFDI|XML|PDF|PAC|timbrad|factura emitida/i);
});

test("manager can preview but cannot mutate or close", async ({ page }) => {
  await mockSettingsShell(page, { role: "manager" });
  await mockFiscalReadRoutes(page);

  await page.goto("/settings/fiscal");
  await expect(page.getByText("Consulta de solo lectura")).toBeVisible();
  await expect(page.getByLabel("Periodicidad")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Guardar preparación" })).toHaveCount(0);
  await page.getByLabel("Fecha de cierre").fill("2024-02-29");
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  await expect(page.getByText("Vista previa lista")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar periodo" })).toHaveCount(0);
});

test("the resolved kill flag hides the route and mounts no fiscal client", async ({ page }) => {
  await mockSettingsShell(page, { enabled: false });
  let fiscalRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/fiscal/")) fiscalRequests += 1;
  });

  await page.goto("/settings/fiscal");
  await expect(page.getByRole("heading", { name: "Perfil del negocio" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Borradores por periodo" })).toHaveCount(0);
  expect(fiscalRequests).toBe(0);
});

test("offline mode disables period mutations while Caja remains available", async ({ page, context }) => {
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page, [closedBatch]);
  await page.goto("/settings/fiscal");
  await expect(page.getByRole("heading", { name: "Preparación por periodo" })).toBeVisible();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByText("Necesitas conexión para hacer cambios")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar preparación" })).toBeDisabled();
  await expect(page.getByLabel("Fecha de cierre")).toBeDisabled();
  await expect(page.getByText(/seguir vendiendo desde Caja/i)).toBeVisible();

  await page.getByRole("button", { name: "Ver reporte para contador" }).click();
  await expect(page.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Imprimir o guardar como PDF" })).toBeEnabled();
  await expect(page.getByText(/Conéctate para descargar el CSV/i)).toBeVisible();
});

test("manager downloads and prints the read-only accountant report", async ({ page }) => {
  await mockSettingsShell(page, { role: "manager" });
  await mockFiscalReadRoutes(page, [closedBatch]);
  await page.route("**/api/v1/fiscal/global-drafts/batches/batch-1/accountant-report.csv", (route) =>
    route.fulfill({
      body: "estado_fiscal,aviso,periodo,total_neto\nNO_EMITIDO,NO_ES_CFDI,2024-02,214.00\n",
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="reporte-control-interno-2024-02.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    }),
  );

  await page.goto("/settings/fiscal");
  await page.getByRole("button", { name: "Ver reporte para contador" }).click();
  await expect(page.getByRole("heading", { name: "Reporte de control interno" })).toBeVisible();
  await expect(page.getByText("Kova Test", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Borrador interno · No es CFDI")).toBeVisible();
  await expect(page.getByText(/Kova no calcula impuestos hoy/i)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("reporte-control-interno-2024-02.csv");

  await page.evaluate(() => {
    window.print = () => document.body.setAttribute("data-accountant-report-printed", "true");
  });
  await page.getByRole("button", { name: "Imprimir o guardar como PDF" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-accountant-report-printed", "true");
  await expect(page.getByRole("button", { name: "Guardar preparación" })).toHaveCount(0);
});

test("accountant CSV failure is recoverable and does not show a false success", async ({ page }) => {
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page, [closedBatch]);
  await page.route("**/api/v1/fiscal/global-drafts/batches/batch-1/accountant-report.csv", (route) =>
    route.fulfill({ status: 500, body: "internal" }),
  );

  await page.goto("/settings/fiscal");
  await page.getByRole("button", { name: "Ver reporte para contador" }).click();
  await page.getByRole("button", { name: "Descargar CSV" }).click();

  await expect(page.getByText(/No pudimos descargar el CSV\./i)).toBeVisible();
  await expect(page.getByText(/Descarga iniciada:/i)).toHaveCount(0);
});
