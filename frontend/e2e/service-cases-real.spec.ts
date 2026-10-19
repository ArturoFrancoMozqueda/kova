import { expect, test } from "./fixtures";
import {
  createTenantThroughUi,
  integrationEnabled,
  logoutThroughUi,
} from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("atención postventa con API, Postgres y RLS reales", () => {
  test.skip(
    !integrationEnabled(),
    "Requiere un stack efímero local de integración",
  );
  test("la atención conserva notas y referencias sin cambiar venta, pagos ni acceso de otros negocios", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    const signupResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/auth/signup") &&
        response.request().method() === "POST",
    );
    await createTenantThroughUi(page, "service-real");
    const signup = await (await signupResponse).json();
    const session = await (
      await page.request.get("/api/v1/auth/session")
    ).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const prepared = await page.evaluate(async (token: string) => {
      const csrf = decodeURIComponent(
        document.cookie
          .split("; ")
          .find((part) => part.startsWith("csrf_token="))!
          .slice("csrf_token=".length),
      );
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`/api/v1${path}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok)
          throw new Error(`Preparación local ${path}: ${response.status}`);
        return response.json();
      };
      await post("/auth/verify", { token });
      const customer = await post("/customers", {
        name: "Cliente atención real",
        phone: null,
        email: null,
        is_active: true,
      });
      const other = await post("/customers", {
        name: "Otro cliente atención real",
        phone: null,
        email: null,
        is_active: true,
      });
      const product = await post("/catalog/products", {
        name: "Servicio local para atención",
        price_amount: "100.00",
        track_inventory: false,
      });
      const order = (customerId: string) =>
        post("/orders", {
          customer_id: customerId,
          items: [{ product_id: product.id, quantity: 1 }],
          payments: [{ method: "manual_card", amount: "100.00" }],
        });
      const sale = await order(customer.id);
      const otherSale = await order(other.id);
      return {
        customer_id: customer.id,
        sale_id: sale.id,
        other_sale_id: otherSale.id,
      };
    }, signup.dev_verification_token);
    await page.goto("/service-cases");
    await page
      .getByRole("button", { name: "Nueva atención postventa" })
      .click();
    await page
      .getByLabel("Cliente de la atención")
      .selectOption(prepared.customer_id);
    await expect(
      page
        .getByLabel("Venta relacionada")
        .locator(`option[value="${prepared.sale_id}"]`),
    ).toHaveCount(1);
    await expect(
      page
        .getByLabel("Venta relacionada")
        .locator(`option[value="${prepared.other_sale_id}"]`),
    ).toHaveCount(0);
    await page.getByLabel("Venta relacionada").selectOption(prepared.sale_id);
    await page
      .getByLabel("Asunto de la atención")
      .fill("Revisar entrega local E2E");
    await page
      .getByLabel("Nota inicial privada")
      .fill("El cliente solicita revisar el acuerdo de entrega.");
    await page
      .getByLabel("Responsable de la atención")
      .selectOption(session.user.id);
    await page
      .getByLabel("Vencimiento de la atención (opcional)")
      .fill("2020-10-19T10:00");
    const creationResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/service-cases") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Registrar atención", exact: true })
      .click();
    const created = await (await creationResponse).json();
    expect(created.overdue).toBe(true);
    expect(created.sale_order_id).toBe(prepared.sale_id);
    expect(created.customer_id).toBe(prepared.customer_id);
    expect(created.assigned_user_id).toBe(session.user.id);
    await page
      .getByRole("button", {
        name: "Abrir atención: Revisar entrega local E2E",
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Detalle de atención" }),
    ).toBeFocused();
    await expect(
      page.getByText("El cliente solicita revisar el acuerdo de entrega."),
    ).toBeVisible();
    await page
      .getByLabel("Nueva nota del equipo")
      .fill("El equipo confirmó que revisará la incidencia.");
    await page
      .getByRole("button", { name: "Agregar nota al historial" })
      .click();
    await expect(
      page.getByText("El equipo confirmó que revisará la incidencia."),
    ).toBeVisible();
    await expect(
      page.getByText("El cliente solicita revisar el acuerdo de entrega."),
    ).toBeVisible();
    await transition("resolved");
    const resolved = await (
      await page.request.get(`/api/v1/service-cases/${created.id}`)
    ).json();
    expect(resolved.status).toBe("resolved");
    expect(resolved.overdue).toBe(false);
    expect(resolved.resolved_at).not.toBeNull();
    await transition("reopened");
    const reopened = await (
      await page.request.get(`/api/v1/service-cases/${created.id}`)
    ).json();
    expect(reopened.overdue).toBe(true);
    expect(reopened.resolved_at).toBeNull();
    await page
      .getByRole("button", { name: "Revisar estado y responsable" })
      .click();
    await page
      .getByLabel("Nuevo estado de la atención")
      .selectOption("in_progress");
    await page.getByLabel("Responsable para seguimiento").selectOption("");
    await page.getByLabel("Nuevo vencimiento (opcional)").fill("");
    const changedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/service-cases/${created.id}`) &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Confirmar cambios", exact: true })
      .click();
    const changed = await (await changedResponse).json();
    expect(changed.due_at).toBeNull();
    expect(changed.assigned_user_id).toBeNull();
    expect(changed.overdue).toBe(false);
    await expect(
      page.getByRole("button", { name: "Confirmar cambios", exact: true }),
    ).toHaveCount(0);
    await transition("cancelled");
    await page
      .getByLabel("Nueva nota del equipo")
      .fill("Se conserva una aclaración privada después del cierre.");
    await page
      .getByRole("button", { name: "Agregar nota al historial" })
      .click();
    await expect(
      page.getByText("Se conserva una aclaración privada después del cierre."),
    ).toBeVisible();
    const history = await (
      await page.request.get(`/api/v1/service-cases/${created.id}/events`)
    ).json();
    expect(history.items).toHaveLength(7);
    expect(
      history.items
        .filter((item: { note: string | null }) => item.note)
        .map((item: { note: string }) => item.note)
        .sort(),
    ).toEqual(
      [
        "El cliente solicita revisar el acuerdo de entrega.",
        "El equipo confirmó que revisará la incidencia.",
        "Se conserva una aclaración privada después del cierre.",
      ].sort(),
    );
    expect(
      history.items.map((item: { case_version: number }) => item.case_version),
    ).toEqual([7, 6, 5, 4, 3, 2, 1]);
    const saleAfter = await (
      await page.request.get(`/api/v1/orders/${prepared.sale_id}`)
    ).json();
    expect(saleAfter.status).toBe("completed");
    expect(saleAfter.total_amount).toBe("100.00");
    expect(saleAfter.payments[0].amount_amount).toBe("100.00");
    expect(
      await (
        await page.request.get(`/api/v1/orders/${prepared.sale_id}/refunds`)
      ).json(),
    ).toEqual([]);
    await logoutThroughUi(page);
    await createTenantThroughUi(page, "service-other-tenant");
    expect(
      (await page.request.get(`/api/v1/service-cases/${created.id}`)).status(),
    ).toBe(404);
    const isolated = await (
      await page.request.get("/api/v1/service-cases")
    ).json();
    expect(isolated.items).toEqual([]);
    await logoutThroughUi(page);
    async function transition(status: string) {
      await page
        .getByRole("button", { name: "Revisar estado y responsable" })
        .click();
      await page.getByLabel("Nuevo estado de la atención").selectOption(status);
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/service-cases/${created.id}`) &&
          response.request().method() === "PATCH",
      );
      await page
        .getByRole("button", { name: "Confirmar cambios", exact: true })
        .click();
      expect((await (await response).json()).status).toBe(status);
      await expect(
        page.getByRole("button", { name: "Confirmar cambios", exact: true }),
      ).toHaveCount(0);
    }
  });
});
