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
  test(`service case intake and history remain accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const record = {
      id: "case-1",
      customer_id: "customer-1",
      customer_name: "Cliente de prueba",
      title: "Revisar la entrega de un pedido de aniversario",
      status: "open",
      assigned_user_id: "user-1",
      assignee_active: true,
      due_at: "2020-10-19T12:00:00Z",
      overdue: true,
      version: 3,
      sale_order_id: "sale-1",
      customer_order_id: null,
      created_at: "2020-10-18T12:00:00Z",
      updated_at: "2020-10-19T12:00:00Z",
      resolved_at: null,
    };
    await page.route("**/api/v1/service-cases?**", (route) =>
      route.fulfill({ json: { items: [record], has_more: false } }),
    );
    await page.route("**/api/v1/service-cases/assignees?**", (route) =>
      route.fulfill({
        json: {
          items: [
            { user_id: "user-1", email: "owner@example.com", role: "owner" },
          ],
          has_more: false,
        },
      }),
    );
    await page.route("**/api/v1/service-cases/references?**", (route) =>
      route.fulfill({
        json: {
          sales: [
            {
              id: "sale-1",
              total_amount: "100.00",
              occurred_at: "2026-10-19T12:00:00Z",
              status: "completed",
            },
          ],
          customer_orders: [{ id: "order-1", folio: "PED-001", status: "new" }],
          sales_has_more: false,
          customer_orders_has_more: false,
        },
      }),
    );
    await page.route("**/api/v1/service-cases/case-1/events?**", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "event-1",
              case_id: record.id,
              case_version: 1,
              kind: "created",
              actor_user_id: "user-1",
              status: "open",
              assigned_user_id: null,
              due_at: null,
              note: "El cliente solicita revisar el acuerdo de entrega. Nota privada del equipo.",
              created_at: "2020-10-18T12:00:00Z",
            },
          ],
          has_more: false,
        },
      }),
    );
    await page.goto("/service-cases");
    await expect(page.getByLabel("Estado de atención")).toBeVisible();
    const statusBounds = await page.getByLabel("Estado de atención").boundingBox();
    expect(statusBounds?.width).toBeGreaterThanOrEqual(160);
    await page
      .getByRole("button", { name: "Nueva atención postventa" })
      .click();
    await page.getByLabel("Cliente de la atención").selectOption("customer-1");
    await page.getByLabel("Asunto de la atención").fill("Revisar entrega");
    await page
      .getByLabel("Nota inicial privada")
      .fill("Nota inicial para el equipo");
    await page.getByLabel("Pedido relacionado").selectOption("order-1");
    await check();
    const opener = page.getByRole("button", {
      name: `Abrir atención: ${record.title}`,
    });
    await opener.click();
    await expect(
      page.getByRole("region", { name: "Detalle de atención" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Revisar estado y responsable" })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirmar cambios" }),
    ).toBeDisabled();
    await page
      .getByLabel("Nueva nota del equipo")
      .fill("Seguimiento nuevo sin modificar notas anteriores");
    await expect(
      page.getByText(
        "El cliente solicita revisar el acuerdo de entrega. Nota privada del equipo.",
      ),
    ).toBeVisible();
    await check();
    await page.getByRole("button", { name: "Cerrar detalle" }).click();
    await expect(opener).toBeFocused();
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
