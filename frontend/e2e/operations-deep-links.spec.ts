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

const exactId = "11111111-1111-4111-8111-111111111111";
const record = {
  id: exactId,
  customer_id: "customer-1",
  customer_name: "Cliente de la entidad",
  title: "Registro fuera de la primera página",
  version: 3,
  due_at: null,
  created_at: "2026-10-19T12:00:00Z",
  updated_at: "2026-10-19T12:00:00Z",
};
const sources = [
  {
    path: "/service-cases",
    parameter: "case_id",
    endpoint: "/api/v1/service-cases",
    data: {
      ...record,
      status: "open",
      assigned_user_id: null,
      assignee_active: false,
      overdue: false,
      sale_order_id: null,
      customer_order_id: null,
      resolved_at: null,
    },
  },
  {
    path: "/crm",
    parameter: "opportunity_id",
    endpoint: "/api/v1/crm/opportunities",
    data: {
      ...record,
      stage: "proposal",
      estimated_amount: "100.00",
      next_action: "Confirmar propuesta",
      note: null,
      assigned_user_id: null,
    },
  },
  {
    path: "/followups",
    parameter: "task_id",
    endpoint: "/api/v1/crm/followups",
    data: {
      ...record,
      status: "completed",
      kind: "incident",
      note: "Seguimiento concluido",
      sale_order_id: null,
      due_at: "2026-10-19T12:00:00Z",
    },
  },
  {
    path: "/appointments",
    parameter: "reminder_id",
    endpoint: "/api/v1/appointments/reminders",
    data: {
      ...record,
      status: "pending",
      appointment_id: "22222222-2222-4222-8222-222222222222",
      appointment_version: 2,
      starts_at: "2026-10-19T18:00:00Z",
      timezone: "America/Cancun",
      due_at: "2026-10-19T12:00:00Z",
    },
  },
];
for (const width of [320, 390, 768, 1440])
  for (const source of sources) {
    test(`exact ${source.parameter} link survives reload at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const methods: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/v1/"))
          methods.push(request.method());
      });
      await page.route("**/api/v1/service-cases?**", (route) =>
        route.fulfill({ json: { items: [], has_more: true } }),
      );
      await page.route("**/api/v1/service-cases/assignees?**", (route) =>
        route.fulfill({ json: { items: [], has_more: false } }),
      );
      await page.route("**/api/v1/service-cases/*/events?**", (route) =>
        route.fulfill({ json: { items: [], has_more: false } }),
      );
      await page.route("**/api/v1/crm?**", (route) =>
        route.fulfill({
          status: 503,
          json: { detail: "La página comercial no está disponible" },
        }),
      );
      await page.route("**/api/v1/crm/followups?**", (route) =>
        route.fulfill({
          json: {
            tasks: [],
            has_more: true,
            policy: {
              enabled: false,
              version: 0,
              review_delay_days: 3,
              rebuy_delay_days: 30,
            },
          },
        }),
      );
      await page.route("**/api/v1/appointments?**", (route) =>
        route.fulfill({ json: { items: [], has_more: true } }),
      );
      await page.route("**/api/v1/appointments/resources", (route) =>
        route.fulfill({ json: { items: [] } }),
      );
      await page.route("**/api/v1/appointments/reminders?**", (route) =>
        route.fulfill({ json: { items: [], has_more: true } }),
      );
      await page.route(`**${source.endpoint}/${exactId}`, (route) =>
        route.fulfill({ json: source.data }),
      );
      await page.goto(`${source.path}?${source.parameter}=${exactId}`);
      const detail =
        source.parameter === "case_id"
          ? page.getByRole("region", { name: "Detalle de atención" })
          : page.getByRole("region", { name: "Registro del enlace" });
      await expect(
        detail.getByRole("heading", { name: record.title }),
      ).toBeVisible();
      await page.reload();
      await expect(
        detail.getByRole("heading", { name: record.title }),
      ).toBeVisible();
      if (source.parameter === "task_id")
        await expect(
          detail.getByRole("button", {
            name: /Confirmar tarea|Revisar Registro/,
          }),
        ).toHaveCount(0);
      if (source.parameter === "opportunity_id") {
        await detail
          .getByRole("button", { name: /Editar seguimiento/ })
          .click();
        await expect(
          page.getByRole("form", { name: "Editar oportunidad" }),
        ).toBeVisible();
      }
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
      await detail.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`${source.parameter}-${width}.png`),
      });
      await page.route(`**${source.endpoint}/${exactId}`, (route) =>
        route.fulfill({ status: 404, json: { detail: "Ya no disponible" } }),
      );
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "Registro del enlace" })
          .getByRole("alert"),
      ).toHaveText(/no está disponible/);
      await expect(
        page
          .getByRole("region", { name: "Registro del enlace" })
          .getByRole("heading", { name: record.title }),
      ).toHaveCount(0);
      expect(methods.every((method) => method === "GET")).toBe(true);
      expect(errors).toEqual([]);
    });
  }
