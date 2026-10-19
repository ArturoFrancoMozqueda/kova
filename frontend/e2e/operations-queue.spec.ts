import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";
import axe from "axe-core";

test.beforeEach(async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/settings/business-profile", (route) =>
    route.fulfill({ json: { timezone: "America/Mexico_City" } }),
  );
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
  test(`read-only operations queue remains accessible at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const queueMethods: string[] = [];
    await page.route("**/api/v1/operations/queue", (route) => {
      queueMethods.push(route.request().method());
      return route.fulfill({
        json: {
          generated_at: "2026-10-19T12:00:00Z",
          sections: [
            {
              source: "service_cases",
              items: [
                {
                  source_id: "case-1",
                  title: "Revisar la entrega de un pedido de aniversario",
                  customer_name: "Cliente de prueba con nombre completo",
                  state: "open",
                  version: 2,
                  due_at: "2020-10-19T12:00:00Z",
                  overdue: true,
                  route_key: "service_cases",
                },
              ],
              has_more: true,
            },
            {
              source: "opportunities",
              items: [
                {
                  source_id: "opp-1",
                  title: "Confirmar una propuesta para el próximo evento",
                  customer_name: "Cliente del evento",
                  state: "proposal",
                  version: 1,
                  due_at: null,
                  overdue: false,
                  route_key: "crm",
                },
              ],
              has_more: false,
            },
            {
              source: "followups",
              items: [
                {
                  source_id: "task-1",
                  title: "Revisar observación de la compra con el equipo",
                  customer_name: "Cliente de postventa",
                  state: "pending",
                  version: 1,
                  due_at: "2026-10-20T12:00:00Z",
                  overdue: false,
                  route_key: "followups",
                },
              ],
              has_more: false,
            },
            {
              source: "appointment_reminders",
              items: [
                {
                  source_id: "reminder-1",
                  title: "Preparar la revisión de la cita vigente",
                  customer_name: "Cliente de agenda",
                  state: "pending",
                  version: 1,
                  due_at: "2026-10-19T12:00:00Z",
                  overdue: true,
                  route_key: "appointments",
                },
              ],
              has_more: false,
            },
          ],
        },
      });
    });
    await page.goto("/operations-queue");
    await expect(
      page.getByRole("heading", {
        name: "Pendientes del negocio",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Revisar la entrega de un pedido de aniversario",
      }),
    ).toBeVisible();
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
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
    );
    expect(violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`operations-queue-${width}.png`),
      fullPage: true,
    });
    const mainLinks = page.locator("main a");
    expect(
      await mainLinks.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      ),
    ).toEqual(["/service-cases", "/crm", "/followups", "/appointments"]);
    const reads = queueMethods.length;
    await page.getByRole("button", { name: "Actualizar pendientes" }).click();
    await expect(
      page.getByRole("button", { name: "Actualizar pendientes" }),
    ).toBeVisible();
    expect(queueMethods.length).toBeGreaterThan(reads);
    expect(queueMethods.every((method) => method === "GET")).toBe(true);
    await page.route("**/api/v1/service-cases?**", (route) =>
      route.fulfill({ json: { items: [], has_more: false } }),
    );
    await page.route("**/api/v1/service-cases/assignees?**", (route) =>
      route.fulfill({ json: { items: [], has_more: false } }),
    );
    await page
      .getByRole("link", { name: "Consultar el resto en Atención postventa" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Atención postventa", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/service-cases");
    expect(errors).toEqual([]);
  });
}
