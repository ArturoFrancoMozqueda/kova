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
          email: "test@example.com",
          phone: null,
          is_active: true,
          created_at: "2026-10-18T12:00:00Z",
        },
      ],
    }),
  );
});
for (const width of [1440, 768, 390, 320]) {
  test(`customer lifecycle stays accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    if (width === 390) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/messaging/conversations?**", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "conv-1",
              customer_id: "customer-1",
              customer_name: "Cliente de prueba",
              subject:
                "Pedido de aniversario de una familia que consulta disponibilidad",
              origin: "manual",
              status: "open",
              automation_paused: true,
              assigned_user_id: null,
              version: 1,
            },
          ],
          has_more: false,
          channel_status: "not_connected",
        },
      }),
    );
    await page.route(
      "**/api/v1/messaging/conversations/conv-1/messages?**",
      (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: "message-1",
                conversation_id: "conv-1",
                direction: "outbound",
                body: "Borrador privado de atención al cliente.",
                message_type: "text",
                state: "draft",
                purpose: "transactional",
                version: 1,
                error_code: null,
                created_at: "2026-10-18T12:00:00Z",
                updated_at: "2026-10-18T12:00:00Z",
              },
            ],
            has_more: false,
          },
        }),
    );
    await page.route("**/api/v1/crm/requests?**", (route) =>
      route.fulfill({
        json: {
          requests: [
            {
              id: "request-1",
              name: "Visitante del catálogo",
              contact: "contacto@example.com",
              message: "Necesito una cotización para veinte personas.",
              product_ids: [],
              status: "new",
              customer_id: null,
              opportunity_id: null,
              version: 1,
              created_at: "2026-10-18T12:00:00Z",
            },
          ],
          has_more: false,
        },
      }),
    );
    await page.route("**/api/v1/crm/followups?**", (route) =>
      route.fulfill({
        json: {
          policy: {
            enabled: false,
            review_delay_days: 3,
            rebuy_delay_days: 30,
            version: 0,
          },
          tasks: [
            {
              id: "task-1",
              customer_id: "customer-1",
              customer_name: "Cliente de prueba",
              sale_order_id: null,
              kind: "incident",
              status: "pending",
              title: "Revisar observación del cliente",
              note: "Nota privada para revisar con el equipo",
              due_at: "2026-10-18T12:00:00Z",
              version: 1,
            },
          ],
          has_more: false,
        },
      }),
    );
    await page.goto("/inbox");
    await page.getByRole("button", { name: /Pedido de aniversario/ }).click();
    await expect(
      page.getByRole("button", { name: "Preparar envío" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Nueva conversación interna" })
      .click();
    await expect(page.getByLabel("Asunto de la conversación")).toBeVisible();
    await check();
    await page.goto("/commercial-requests");
    await page
      .getByRole("button", {
        name: "Revisar solicitud de Visitante del catálogo",
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Crear oportunidad con este cliente" }),
    ).toBeDisabled();
    await check();
    await page.goto("/followups");
    await page.getByRole("button", { name: "Revisar regla" }).click();
    await page.getByRole("button", { name: "Registrar incidencia" }).click();
    await expect(page.getByLabel("Asunto de la incidencia")).toBeVisible();
    await check();
    await page.route("**/api/v1/public/catalog/public-test", (route) =>
      route.fulfill({
        json: {
          title: "Catálogo público de prueba",
          description: "Productos publicados",
          whatsapp_phone: null,
          checkout_available: false,
          products: [
            {
              id: "product-1",
              name: "Producto del catálogo",
              description: null,
              price_amount: "40.00",
              availability: "available",
            },
          ],
        },
      }),
    );
    await page.route("**/api/v1/public/catalog/public-test/requests", (route) =>
      route.fulfill({ json: { receipt_id: "receipt-1", status: "received" } }),
    );
    await page.goto("/catalogo/public-test");
    await page.getByLabel("Tu nombre").fill("Ana de prueba");
    await page
      .getByLabel("Teléfono o correo para responder")
      .fill("test@example.com");
    await page
      .getByLabel("¿Qué te gustaría consultar?")
      .fill("Quiero consultar disponibilidad");
    await expect(page.getByLabel("Tu nombre")).toHaveValue("Ana de prueba");
    await expect(
      page.getByLabel("Teléfono o correo para responder"),
    ).toHaveValue("test@example.com");
    await check();
    await page
      .getByRole("button", { name: "Enviar solicitud al negocio" })
      .click();
    await expect(page.getByText(/Solicitud recibida/)).toBeVisible();
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
