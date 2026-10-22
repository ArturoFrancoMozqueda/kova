import { expect, test } from "./fixtures";
import {
  createTenantThroughUi,
  integrationEnabled,
  logoutThroughUi,
} from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("agenda y lealtad con Postgres/RLS reales", () => {
  test.skip(
    !integrationEnabled(),
    "Requiere el stack efímero local de integración",
  );
  test("la cita conserva su zona y los puntos conservan ventas, devoluciones y canjes separados", async ({
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
    await createTenantThroughUi(page, "ops-real");
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
        name: "Cliente agenda y lealtad real",
        phone: null,
        email: null,
        is_active: true,
      });
      const product = await post("/catalog/products", {
        name: "Servicio prueba local agenda",
        price_amount: "100.00",
        track_inventory: false,
      });
      return { customer_id: customer.id, product_id: product.id };
    }, signup.dev_verification_token);

    await page.goto("/appointments");
    await page.getByRole("button", { name: "Agregar recurso" }).click();
    await page.getByLabel("Nombre del recurso").fill("Asesoría local Cancún");
    await page
      .getByLabel("Zona horaria del recurso")
      .selectOption("America/Cancun");
    const resourceResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/appointments/resources") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Crear recurso", exact: true })
      .click();
    const resource = await (await resourceResponse).json();
    expect(resource.timezone).toBe("America/Cancun");
    await expect(
      page.getByRole("status").filter({ hasText: "Recurso creado" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Nueva cita", exact: true }).click();
    await page.getByLabel("Recurso de la cita").selectOption(resource.id);
    await page
      .getByLabel("Cliente de la cita")
      .selectOption(prepared.customer_id);
    await page.getByLabel("Motivo de la cita").fill("Visita local E2E");
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("Inicio de la cita").fill(`${day}T10:00`);
    await page.getByLabel("Fin de la cita").fill(`${day}T11:00`);
    const bookingResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/appointments") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirmar cita", exact: true })
      .click();
    const booking = await (await bookingResponse).json();
    expect(booking.starts_at).toBe(`${day}T15:00:00Z`);
    expect(booking.ends_at).toBe(`${day}T16:00:00Z`);
    await expect(
      page.getByRole("heading", { name: "Visita local E2E" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reprogramar Visita local E2E" })
      .click();
    await expect(page.getByLabel("Inicio de la cita")).toHaveValue(
      `${day}T10:00`,
    );
    await page.getByLabel("Inicio de la cita").fill(`${day}T13:00`);
    await page.getByLabel("Fin de la cita").fill(`${day}T14:00`);
    await page.getByRole("button", { name: "Confirmar nuevo horario" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Cita reprogramada" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancelar cita", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmar estado", exact: true })
      .click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible();
    const history = await (
      await page.request.get(`/api/v1/appointments/${booking.id}/history`)
    ).json();
    expect(
      history.items.map((item: { action: string }) => item.action).sort(),
    ).toEqual(["cancelled", "created", "rescheduled"]);
    expect(
      history.items.every((item: { starts_at: string }) =>
        item.starts_at.endsWith("Z"),
      ),
    ).toBe(true);

    await page.goto("/loyalty");
    await page.getByRole("button", { name: "Revisar regla de puntos" }).click();
    await expect(
      page.getByLabel("Compra necesaria por bloque (MXN)"),
    ).toHaveValue("");
    await page.getByLabel("Compra necesaria por bloque (MXN)").fill("100.00");
    await page.getByLabel("Puntos por bloque de compra").fill("5");
    await page.getByLabel("Acumular puntos en nuevas ventas elegibles").check();
    await page
      .getByRole("button", { name: "Confirmar regla de puntos", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Regla de lealtad actualizada" }),
    ).toBeVisible();
    const sale = await page.evaluate(
      async (ids: { customer_id: string; product_id: string }) => {
        const csrf = decodeURIComponent(
          document.cookie
            .split("; ")
            .find((part) => part.startsWith("csrf_token="))!
            .slice("csrf_token=".length),
        );
        const response = await fetch("/api/v1/orders", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            customer_id: ids.customer_id,
            items: [{ product_id: ids.product_id, quantity: 2 }],
            payments: [{ method: "manual_card", amount: "200.00" }],
          }),
        });
        if (!response.ok)
          throw new Error(
            `Venta local: ${response.status}: ${await response.text()}`,
          );
        return response.json();
      },
      prepared,
    );
    await page
      .getByRole("button", { name: "Actualizar movimientos de puntos" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Movimientos revisados" }),
    ).toBeVisible();
    await page
      .getByLabel("Cliente del programa")
      .selectOption(prepared.customer_id);
    await expect(
      page.getByRole("status", { name: "Saldo de puntos" }),
    ).toHaveText("10 puntos");
    await page
      .getByRole("button", { name: "Preparar canje de puntos" })
      .click();
    await page.getByLabel("Puntos a canjear").fill("4");
    await page
      .getByLabel("Beneficio acordado con el cliente")
      .fill("Beneficio local pendiente de entrega manual");
    await page.getByLabel(/Confirmo el débito de puntos/).check();
    await page
      .getByRole("button", { name: "Confirmar canje de puntos", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Canje registrado en puntos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Saldo de puntos" }),
    ).toHaveText("6 puntos");
    const unchangedSale = await (
      await page.request.get(`/api/v1/orders/${sale.id}`)
    ).json();
    expect(unchangedSale.total_amount).toBe("200.00");
    expect(unchangedSale.payments[0].amount_amount).toBe("200.00");
    await page.evaluate(
      async (order: { id: string; items: { id: string }[] }) => {
        const csrf = decodeURIComponent(
          document.cookie
            .split("; ")
            .find((part) => part.startsWith("csrf_token="))!
            .slice("csrf_token=".length),
        );
        const response = await fetch(`/api/v1/orders/${order.id}/refunds`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            items: [{ order_item_id: order.items[0].id, quantity: 2 }],
            reason: "customer_return",
            refund_payment_method: "manual_card",
          }),
        });
        if (!response.ok)
          throw new Error(`Devolución local: ${response.status}`);
      },
      sale,
    );
    await page.goto("/loyalty");
    await page
      .getByLabel("Cliente del programa")
      .selectOption(prepared.customer_id);
    await expect(
      page.getByText(/Procesa devoluciones o anulaciones pendientes/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preparar canje de puntos" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Actualizar movimientos de puntos" })
      .click();
    await expect(
      page.getByRole("status", { name: "Saldo de puntos" }),
    ).toHaveText("-4 puntos");
    const ledger = await (
      await page.request.get(
        `/api/v1/loyalty/customers/${prepared.customer_id}`,
      )
    ).json();
    expect(ledger.balance).toBe(-4);
    expect(
      ledger.entries.map((item: { kind: string }) => item.kind).sort(),
    ).toEqual(["accrual", "redemption", "refund"]);
    await page
      .getByRole("button", { name: "Actualizar movimientos de puntos" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Movimientos revisados" }),
    ).toBeVisible();
    const replay = await (
      await page.request.get(
        `/api/v1/loyalty/customers/${prepared.customer_id}`,
      )
    ).json();
    expect(replay.entries).toHaveLength(3);
    expect(replay.balance).toBe(-4);
    await logoutThroughUi(page);
  });
});
