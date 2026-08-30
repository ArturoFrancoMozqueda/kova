import { type Page, expect, test } from "./fixtures";

const settings = {
  configured: true,
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
  package_schema_version: "accountant-package-v2",
  tax_calculation_status: "not_calculated",
  gross_amount: "232.00",
  discount_total_amount: "0.00",
  tax_total_amount: "32.00",
  total_amount: "232.00",
  refund_total_amount: "18.00",
  net_total_amount: "214.00",
  adjustment_total_amount: "-18.00",
  adjusted_net_amount: "196.00",
  adjustment_count: 1,
  data_quality_warnings: ["TAXES_NOT_CALCULATED"],
  order_count: 2,
  excluded_individually_confirmed_count: 1,
};

const closedBatch = {
  ...preview,
  id: "batch-1",
  status: "closed",
  order_ids: ["order-1", "order-2"],
  closed_at: "2024-03-01T06:00:00Z",
  business_name_snapshot: "Kova Test al cierre",
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

async function mockFiscalReadRoutes(
  page: Page,
  batches: typeof closedBatch[] = [],
  initialSettings = settings,
) {
  const currentSettings = { ...initialSettings };
  await page.route("**/api/v1/fiscal/global-drafts/settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      Object.assign(currentSettings, body, { configured: true });
    }
    await route.fulfill({ json: currentSettings });
  });
  await page.route("**/api/v1/fiscal/global-drafts/batches", (route) =>
    route.fulfill({ json: { items: batches, total: batches.length } }),
  );
  await page.route("**/api/v1/fiscal/global-drafts/preview**", (route) =>
    route.fulfill({ json: preview }),
  );
}

test("owner configures, previews and freezes an accountant close", async ({ page }) => {
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
        business_name_snapshot: "Kova Test al cierre",
      },
    });
  });

  await page.goto("/settings/fiscal");
  await expect(page.getByRole("heading", { name: "Cierres para contador" })).toBeVisible();
  await page.getByRole("checkbox", { name: /cerrar automáticamente/i }).check();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Configuración de cierres guardada.")).toBeVisible();

  await page.getByLabel("Fecha de cierre").fill("2024-02-29");
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  await expect(page.getByText("Vista previa lista")).toBeVisible();
  await expect(page.getByText(/2 ventas incluidas.*1 excluida/i)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar periodo" }).click();
  await page.getByRole("button", { name: "Congelar cierre" }).click();
  await expect(page.getByText("Cierre para contador guardado.")).toBeVisible();
  expect(closeKey).not.toBe("");

  const body = await page.locator("body").innerText();
  expect(body).toMatch(/cierre para contador/i);
  expect(body).toMatch(/recibos? operativos?/i);
  expect(body).toMatch(/ni emite CFDI/i);
  expect(body).not.toMatch(/XML|PAC|timbrad|factura emitida/i);
});

test("manager can preview but cannot mutate or close", async ({ page }) => {
  await mockSettingsShell(page, { role: "manager" });
  await mockFiscalReadRoutes(page);

  await page.goto("/settings/fiscal");
  await expect(page.getByText("Consulta de solo lectura")).toBeVisible();
  await expect(page.getByLabel("Periodicidad")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Guardar configuración" })).toHaveCount(0);
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
  await expect(page.getByRole("link", { name: "Cierres para contador" })).toHaveCount(0);
  expect(fiscalRequests).toBe(0);
});

test("offline mode disables period mutations while Caja remains available", async ({ page, context }) => {
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page, [closedBatch]);
  await page.goto("/settings/fiscal");
  await expect(page.getByRole("heading", { name: "Cierres para contador" })).toBeVisible();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByText("Necesitas conexión para hacer cambios")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar configuración" })).toBeDisabled();
  await expect(page.getByLabel("Fecha de cierre")).toBeDisabled();
  await expect(page.getByText(/seguir vendiendo desde Caja/i)).toBeVisible();

  await page.getByRole("button", { name: "Ver reporte para contador" }).click();
  await expect(page.getByRole("button", { name: "Descargar paquete ZIP" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Imprimir o guardar como PDF" })).toBeEnabled();
  await expect(page.getByText(/Conéctate para descargar el paquete/i)).toBeVisible();
});

test("manager downloads and prints the read-only accountant report", async ({ page }) => {
  await mockSettingsShell(page, { role: "manager" });
  await mockFiscalReadRoutes(page, [closedBatch]);
  await page.route("**/api/v1/fiscal/global-drafts/batches/batch-1/accountant-package.zip", (route) =>
    route.fulfill({
      body: "PK accountant package",
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="kova-cierre-contador-2024-02.zip"',
        "Content-Type": "application/zip",
      },
    }),
  );

  await page.goto("/settings/fiscal");
  await page.getByRole("button", { name: "Ver reporte para contador" }).click();
  await expect(page.getByRole("heading", { name: "Resumen del cierre" })).toBeVisible();
  await expect(page.getByText("Kova Test al cierre", { exact: true })).toBeVisible();
  await expect(page.getByText("No emitido · No es CFDI")).toBeVisible();
  await expect(page.getByText(/Kova no calcula IVA ni IEPS/i)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar paquete ZIP" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("kova-cierre-contador-2024-02.zip");

  await page.evaluate(() => {
    window.print = () => document.body.setAttribute("data-accountant-report-printed", "true");
  });
  await page.getByRole("button", { name: "Imprimir o guardar como PDF" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-accountant-report-printed", "true");
  await expect(page.getByRole("button", { name: "Guardar configuración" })).toHaveCount(0);
});

test("accountant package failure is recoverable and does not show a false success", async ({ page }) => {
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page, [closedBatch]);
  await page.route("**/api/v1/fiscal/global-drafts/batches/batch-1/accountant-package.zip", (route) =>
    route.fulfill({ status: 500, body: "internal" }),
  );

  await page.goto("/settings/fiscal");
  await page.getByRole("button", { name: "Ver reporte para contador" }).click();
  await page.getByRole("button", { name: "Descargar paquete ZIP" }).click();

  await expect(page.getByText(/No pudimos descargar el paquete\./i)).toBeVisible();
  await expect(page.getByText(/Descarga iniciada:/i)).toHaveCount(0);
});

test("owner persists defaults before the incident date flow can preview", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-16T18:00:00Z"));
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page, [], { ...settings, configured: false });
  let previewUrl = "";
  await page.route("**/api/v1/fiscal/global-drafts/preview**", (route) => {
    previewUrl = route.request().url();
    return route.fulfill({
      json: { ...preview, period_start: "2026-07-01", period_end: "2026-07-31" },
    });
  });

  await page.goto("/settings/fiscal");
  await expect(page.getByText("Guarda la preparación para continuar")).toBeVisible();
  await expect(page.getByLabel("Fecha de cierre")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Preparar vista previa" })).toBeDisabled();
  expect(previewUrl).toBe("");

  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByLabel("Fecha de cierre")).toBeEnabled();
  await expect(page.getByLabel("Fecha de cierre")).toHaveValue("2026-07-31");
  await page.getByRole("button", { name: "Preparar vista previa" }).click();

  await expect(page.getByText("Vista previa lista")).toBeVisible();
  expect(new URL(previewUrl).searchParams.get("period_end")).toBe("2026-07-31");
});

test("monthly day 31 rejects July 16 inline without a request", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-16T18:00:00Z"));
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page);
  let previewRequests = 0;
  await page.route("**/api/v1/fiscal/global-drafts/preview**", (route) => {
    previewRequests += 1;
    return route.fulfill({ json: preview });
  });

  await page.goto("/settings/fiscal");
  await page.getByLabel("Fecha de cierre").fill("2026-07-16");

  await expect(page.getByRole("alert").filter({ hasText: "la fecha de cierre" })).toContainText(
    "31 jul 2026",
  );
  await expect(page.getByRole("button", { name: "Preparar vista previa" })).toBeDisabled();
  expect(previewRequests).toBe(0);
});

test("dirty settings clear a prepared preview and block another request", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-16T18:00:00Z"));
  await mockSettingsShell(page);
  await mockFiscalReadRoutes(page);
  let previewRequests = 0;
  await page.route("**/api/v1/fiscal/global-drafts/preview**", (route) => {
    previewRequests += 1;
    return route.fulfill({
      json: { ...preview, period_start: "2026-07-01", period_end: "2026-07-31" },
    });
  });

  await page.goto("/settings/fiscal");
  await page.getByRole("button", { name: "Preparar vista previa" }).click();
  await expect(page.getByText("Vista previa lista")).toBeVisible();
  expect(previewRequests).toBe(1);

  await page.getByLabel("Día de cierre mensual").fill("15");

  await expect(page.getByText("Vista previa lista")).toHaveCount(0);
  await expect(page.getByText("Hay cambios sin guardar")).toBeVisible();
  await expect(page.getByLabel("Fecha de cierre")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Preparar vista previa" })).toBeDisabled();
  expect(previewRequests).toBe(1);
});

test("manager sees who must configure synthetic defaults", async ({ page }) => {
  await mockSettingsShell(page, { role: "manager" });
  await mockFiscalReadRoutes(page, [], { ...settings, configured: false });

  await page.goto("/settings/fiscal");

  await expect(page.getByText("El propietario aún no guarda esta preparación")).toBeVisible();
  await expect(page.getByLabel("Fecha de cierre")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Guardar configuración" })).toHaveCount(0);
});

for (const locale of ["es-MX", "en-US"] as const) {
  test.describe(`Mexico date input with ${locale} locale`, () => {
    test.use({ locale, timezoneId: "America/Mexico_City" });

    test("keeps the ISO query independent from the native date display", async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-08-16T18:00:00Z"));
      await mockSettingsShell(page);
      await mockFiscalReadRoutes(page);
      let previewUrl = "";
      await page.route("**/api/v1/fiscal/global-drafts/preview**", (route) => {
        previewUrl = route.request().url();
        return route.fulfill({
          json: { ...preview, period_start: "2026-07-01", period_end: "2026-07-31" },
        });
      });

      await page.goto("/settings/fiscal");
      expect(await page.evaluate(() => navigator.language)).toBe(locale);
      await expect(page.getByLabel("Fecha de cierre")).toHaveValue("2026-07-31");
      await page.getByRole("button", { name: "Preparar vista previa" }).click();

      await expect(page.getByText("Vista previa lista")).toBeVisible();
      expect(new URL(previewUrl).searchParams.get("period_end")).toBe("2026-07-31");
    });
  });
}
