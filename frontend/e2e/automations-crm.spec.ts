import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

test.beforeEach(async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          id: "user-1",
          email: "owner@example.com",
          tenant_id: "tenant-1",
          role: "owner",
        },
        tenant_id: "tenant-1",
        tenant_name: "Negocio de prueba",
      },
    }),
  );
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({
      json: {
        plan: {
          name: "Standard Plan",
          amount_minor_units: 29900,
          currency: "MXN",
          interval: "month",
        },
        subscription: null,
        access: {
          allowed: true,
          reason: "active",
          trialing: false,
          trial_ends_at: null,
          blocked_at: null,
          recovery_path: "/settings/billing",
        },
      },
    }),
  );
});

for (const width of [1440, 768, 390, 320]) {
  test(`automation and CRM controls remain accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const rules = [
      {
        template_key: "order_ready",
        title: "Pedido listo para entregar",
        description:
          "Crea una tarea interna cuando el equipo termina un pedido.",
        enabled: false,
        version: 0,
      },
    ];
    await page.route("**/api/v1/automations", (route) =>
      route.fulfill({
        json: {
          rules,
          runs: [],
          capabilities: {
            internal_tasks: true,
            external_messaging: false,
            financial_actions: false,
          },
        },
      }),
    );
    await page.goto("/automations");
    await expect(
      page.getByRole("heading", { name: "Automatizaciones", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Activar Pedido listo para entregar",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirmar activación" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const automationViolations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (
                  context: string,
                  options: unknown,
                ) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run("main", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    );
    expect(automationViolations).toEqual([]);

    await page.route("**/api/v1/customers?**", (route) =>
      route.fulfill({
        json: [
          {
            id: "customer-1",
            name: "Cliente registrado",
            phone: null,
            email: null,
            is_active: true,
            created_at: "2026-10-18T12:00:00Z",
          },
        ],
      }),
    );
    await page.route("**/api/v1/crm?**", (route) =>
      route.fulfill({
        json: {
          opportunities: [],
          consents: [],
          opportunities_has_more: false,
          consents_has_more: false,
          capabilities: { whatsapp: "not_connected", email: "not_connected" },
        },
      }),
    );
    await page.goto("/crm");
    await expect(
      page.getByRole("heading", { name: "Seguimiento comercial", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Nueva oportunidad", exact: true })
      .click();
    await expect(page.getByLabel("¿Qué necesita el cliente?")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const crmViolations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (
                  context: string,
                  options: unknown,
                ) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run("main", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    );
    expect(crmViolations).toEqual([]);

    await page.route("**/api/v1/catalog/products", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/api/v1/quotes?**", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "quote-1",
              folio: "COT-001",
              status: "sent",
              customer_id: "customer-1",
              customer_name: `Cliente ${"a".repeat(80)}`,
              expires_at: "2099-01-01T12:00:00Z",
              total_amount: "90.00",
              version: 2,
              customer_order_id: null,
              created_at: "2026-10-18T12:00:00Z",
              updated_at: "2026-10-18T12:00:00Z",
              items: [
                {
                  id: "item-1",
                  product_id: "product-1",
                  product_name: "Producto publicado",
                  quantity: 2,
                  unit_price_amount: "45.00",
                  line_total_amount: "90.00",
                },
              ],
            },
          ],
          total: 1,
        },
      }),
    );
    await page.goto("/quotes");
    await page
      .getByRole("button", { name: "Registrar aceptación", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Registrar aceptación y crear pedido" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const quoteViolations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (
                  context: string,
                  options: unknown,
                ) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run("main", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    );
    expect(quoteViolations).toEqual([]);

    await page.route("**/api/v1/messaging/readiness", (route) =>
      route.fulfill({
        json: {
          status: "not_connected",
          send_enabled: false,
          webhook_enabled: false,
          tenant_mapping_verified: false,
          checklist: [
            {
              key: "number",
              title: "Verifica el número empresarial",
              description:
                "Revisa el alta del número en Meta antes de conectar el canal.",
              status: "required",
            },
          ],
        },
      }),
    );
    await page.goto("/settings/channels");
    await expect(
      page.getByRole("heading", { name: "Canales del negocio", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Sin conectar", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const channelsViolations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (
                  context: string,
                  options: unknown,
                ) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run("main", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    );
    expect(channelsViolations).toEqual([]);

    await page.route("**/api/v1/reconciliation/entries?**", (route) =>
      route.fulfill({ json: { entries: [], has_more: false } }),
    );
    await page.goto("/reconciliation");
    await expect(
      page.getByRole("heading", {
        name: "Conciliación de depósitos",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByText("Columnas y requisitos del archivo").click();
    await page.route("**/api/v1/reconciliation/imports/preview", (route) =>
      route.fulfill({
        json: {
          parser_version: 1,
          content_sha256: "a".repeat(64),
          errors: [],
          rows: [
            {
              row_number: 2,
              settled_at: "2026-10-18T12:00:00Z",
              gross_amount: "100.00",
              fee_amount: "3.00",
              net_amount: "97.00",
              currency: "MXN",
              payment_method: "manual_card",
              external_reference_masked: "***1234",
              row_fingerprint: "b".repeat(64),
            },
          ],
        },
      }),
    );
    await page.getByLabel("Archivo CSV de liquidaciones").setInputFiles({
      name: "valid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "settled_at,gross_amount,fee_amount,net_amount,currency,payment_method,reference\n2026-10-18T12:00:00Z,100.00,3.00,97.00,MXN,manual_card,***1234",
      ),
    });
    await page.getByRole("button", { name: "Revisar archivo" }).click();
    await page
      .getByRole("checkbox", { name: "Importar fila 2", exact: true })
      .check();
    await expect(
      page.getByRole("button", {
        name: "Importar 1 movimientos seleccionados",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const reconciliationViolations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (
                  context: string,
                  options: unknown,
                ) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run("main", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    );
    expect(reconciliationViolations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
