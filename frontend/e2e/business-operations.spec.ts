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
  await page.route("**/api/v1/customers?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "customer-1",
          name: "Cliente de prueba",
          email: null,
          phone: null,
          is_active: true,
          created_at: "2026-10-19T12:00:00Z",
        },
      ],
    }),
  );
});
for (const width of [1440, 768, 390, 320]) {
  test(`appointments and loyalty remain accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const resource = {
      id: "resource-1",
      name: "Atención de mostrador con nombre completo",
      timezone: "America/Mexico_City",
      is_active: true,
      version: 1,
    };
    const appointment = {
      id: "appointment-1",
      resource_id: resource.id,
      resource_name: resource.name,
      timezone: resource.timezone,
      customer_id: "customer-1",
      customer_name: "Cliente de prueba",
      title: "Consulta para un pedido de aniversario",
      starts_at: "2099-10-20T16:00:00Z",
      ends_at: "2099-10-20T17:00:00Z",
      note: "Revisar disponibilidad con el cliente.",
      status: "scheduled",
      version: 1,
      created_at: "2026-10-19T12:00:00Z",
      updated_at: "2026-10-19T12:00:00Z",
    };
    await page.route("**/api/v1/appointments?**", (route) =>
      route.fulfill({ json: { items: [appointment], has_more: false } }),
    );
    await page.route("**/api/v1/appointments/resources", (route) =>
      route.fulfill({ json: { items: [resource] } }),
    );
    await page.route("**/api/v1/appointments/reminders?**", (route) =>
      route.fulfill({ json: { items: [], has_more: false } }),
    );
    await page.route("**/api/v1/appointments/appointment-1/history", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "history-1",
              appointment_id: appointment.id,
              appointment_version: 1,
              action: "created",
              status: "scheduled",
              starts_at: appointment.starts_at,
              ends_at: appointment.ends_at,
              note: null,
              actor_user_id: "user-1",
              created_at: appointment.created_at,
            },
          ],
        },
      }),
    );
    await page.goto("/appointments");
    await page.getByRole("button", { name: "Agregar recurso" }).click();
    await page.getByRole("button", { name: "Nueva cita" }).click();
    await page.getByLabel("Recurso de la cita").selectOption(resource.id);
    await page.getByLabel("Cliente de la cita").selectOption("customer-1");
    await page.getByLabel("Motivo de la cita").fill("Consulta de sabores");
    await page.getByLabel("Inicio de la cita").fill("2099-10-20T10:00");
    await page.getByLabel("Fin de la cita").fill("2099-10-20T11:00");
    await page
      .getByRole("button", {
        name: "Ver historial de Consulta para un pedido de aniversario",
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Historial de cambios" }),
    ).toBeVisible();
    await check();
    const policy = {
      enabled: false,
      spend_amount: null,
      points_per_step: null,
      version: 0,
    };
    await page.route("**/api/v1/loyalty?**", (route) =>
      route.fulfill({
        json: {
          policy,
          accounts: [
            {
              customer_id: "customer-1",
              customer_name: "Cliente de prueba",
              balance: 50,
            },
          ],
          accounts_has_more: false,
        },
      }),
    );
    await page.route("**/api/v1/loyalty/customers/customer-1?**", (route) =>
      route.fulfill({
        json: {
          customer_id: "customer-1",
          customer_name: "Cliente de prueba",
          balance: 50,
          adjustments_pending: false,
          entries: [
            {
              id: "entry-1",
              kind: "accrual",
              points: 50,
              sale_order_id: "sale-1",
              benefit: null,
              created_at: "2026-10-19T12:00:00Z",
            },
          ],
          has_more: false,
        },
      }),
    );
    await page.goto("/loyalty");
    await page.getByRole("button", { name: "Revisar regla de puntos" }).click();
    await expect(
      page.getByLabel("Compra necesaria por bloque (MXN)"),
    ).toHaveValue("");
    await page
      .getByRole("button", { name: /Cliente de prueba.*50 puntos/ })
      .click();
    await page
      .getByRole("button", { name: "Preparar canje de puntos" })
      .click();
    await page.getByLabel("Puntos a canjear").fill("20");
    await page
      .getByLabel("Beneficio acordado con el cliente")
      .fill("Beneficio acordado por revisar manualmente");
    await expect(
      page.getByRole("button", { name: "Confirmar canje de puntos" }),
    ).toBeDisabled();
    await check();
    expect(errors).toEqual([]);
    async function check() {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(
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
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations,
      );
      expect(violations).toEqual([]);
    }
  });
}
