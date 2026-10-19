import { expect, test } from "./fixtures";
import {
  createTenantThroughUi,
  integrationEnabled,
  logoutThroughUi,
} from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("automatización comercial con API, Postgres y RLS reales", () => {
  test.skip(
    !integrationEnabled(),
    "Requiere el stack efímero local de integración",
  );

  test("cotización, tareas, cliente, catálogo, reposición y conciliación conservan sus efectos reales", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
    const signupResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/auth/signup") &&
        response.request().method() === "POST",
    );
    await createTenantThroughUi(page, "e2e-business");
    const signup = await (await signupResponse).json();
    const session = await (
      await page.request.get("/api/v1/auth/session")
    ).json();
    await markFirstUseToursSeen(page, session.tenant_id);
    const prepared = await page.evaluate(async (verificationToken: string) => {
      const csrf = document.cookie
        .split("; ")
        .find((part) => part.startsWith("csrf_token="))
        ?.slice("csrf_token=".length);
      if (!csrf || !verificationToken)
        throw new Error(
          "El stack local debe proporcionar sesión CSRF y verificación de desarrollo",
        );
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`/api/v1${path}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": decodeURIComponent(csrf),
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok)
          throw new Error(`Preparación local ${path}: ${response.status}`);
        return await response.json();
      };
      await post("/auth/verify", { token: verificationToken });
      const product = await post("/catalog/products", {
        name: "Harina integración E2E",
        price_amount: "45.00",
        cost_price: "12.50",
        track_inventory: true,
        low_stock_threshold: 5,
      });
      const supplier = await post("/purchasing/suppliers", {
        name: "Proveedor integración E2E",
        contact: null,
      });
      const customer = await post("/customers", {
        name: "Cliente integración E2E",
        phone: "525550000000",
        email: "cliente-e2e@example.com",
        is_active: true,
      });
      const service = await post("/catalog/products", {
        name: "Servicio integración E2E",
        price_amount: "100.00",
        track_inventory: false,
      });
      const sale = await post("/orders", {
        items: [{ product_id: service.id, quantity: 1 }],
        payments: [
          { method: "manual_card", amount: "100.00", reference: "***1234" },
        ],
      });
      return {
        product: { id: product.id, name: product.name },
        supplier: { id: supplier.id, name: supplier.name },
        customer: { id: customer.id, name: customer.name },
        sale_id: sale.id,
      };
    }, signup.dev_verification_token);

    await page.goto("/automations");
    await page
      .getByRole("button", {
        name: "Activar Revisión de reposición",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Confirmar activación", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Automatización activada" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revisar eventos" }).click();
    await expect(page.getByRole("button", { name: /^Completar / })).toHaveCount(
      1,
    );
    await page.getByRole("button", { name: /^Completar / }).click();
    await expect(
      page.getByText("Tarea marcada como completada."),
    ).toBeVisible();

    await page.goto("/crm");
    await page
      .getByRole("button", { name: "Nueva oportunidad", exact: true })
      .click();
    await page
      .getByLabel("Cliente registrado", { exact: true })
      .selectOption(prepared.customer.id);
    await page
      .getByLabel("¿Qué necesita el cliente?")
      .fill("Pedido del próximo evento");
    await page.getByLabel("Valor estimado en MXN").fill("90.00");
    await page.getByLabel("Siguiente acción").fill("Confirmar cantidades");
    await page.getByRole("button", { name: "Guardar oportunidad" }).click();
    await expect(
      page.getByRole("heading", { name: "Pedido del próximo evento" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: /Confirmo que este cliente autorizó/ })
      .check();
    await page
      .getByRole("button", { name: "Registrar permiso", exact: true })
      .click();
    await expect(page.getByText(/Permiso registrado/)).toBeVisible();

    await page.goto("/quotes");
    await page
      .getByRole("button", { name: "Nueva cotización", exact: true })
      .click();
    await page
      .getByLabel("Cliente registrado", { exact: true })
      .selectOption(prepared.customer.id);
    await page
      .getByLabel("Vigencia (hora de este dispositivo)")
      .fill("2099-01-01T12:00");
    await page
      .getByLabel("Producto", { exact: true })
      .selectOption(prepared.product.id);
    await page.getByLabel("Cantidad", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Agregar producto" }).click();
    await page
      .getByRole("button", { name: "Crear cotización", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Registrar propuesta compartida" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Registrar propuesta compartida" })
      .click();
    await page
      .getByRole("checkbox", { name: /Confirmo que el equipo ya compartió/ })
      .check();
    await page
      .getByRole("button", { name: "Registrar que fue compartida" })
      .click();
    await page
      .getByRole("button", { name: "Registrar aceptación", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: /Confirmo que el cliente aceptó/ })
      .check();
    await page
      .getByRole("button", { name: "Registrar aceptación y crear pedido" })
      .click();
    await expect(
      page.getByRole("link", { name: "Revisar pedido creado" }),
    ).toBeVisible();

    await page.goto("/settings/public-catalog");
    await page
      .getByLabel("Nombre del catálogo")
      .fill("Catálogo integración E2E");
    await page
      .getByRole("checkbox", { name: new RegExp(prepared.product.name) })
      .check();
    await page
      .getByRole("checkbox", { name: "Publicar catálogo", exact: true })
      .check();
    await page.getByRole("button", { name: "Guardar publicación" }).click();
    const publicLink = page.getByRole("link", {
      name: "Abrir catálogo público",
    });
    await expect(publicLink).toBeVisible();
    const sharePath = await publicLink.getAttribute("href");
    const publicContext = await browser.newContext();
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(new URL(sharePath!, baseURL).toString());
      await expect(
        publicPage.getByRole("heading", {
          name: prepared.product.name,
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await publicContext.close();
    }

    await page.goto("/replenishment");
    await page
      .getByLabel("Proveedor", { exact: true })
      .selectOption(prepared.supplier.id);
    await page
      .getByRole("button", { name: "Revisar compra", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Confirmación de compra" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirmar y crear compra pendiente" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Compra pendiente creada" }),
    ).toBeVisible();
    const purchases = await (
      await page.request.get("/api/v1/purchasing/orders")
    ).json();
    expect(purchases).toHaveLength(1);
    expect(purchases[0].status).toBe("pending");

    await page.goto("/reconciliation");
    const csv = `settled_at,gross_amount,fee_amount,net_amount,currency,payment_method,reference\n${new Date().toISOString()},100.00,3.00,97.00,MXN,manual_card,***1234`;
    await page
      .getByLabel("Archivo CSV de liquidaciones")
      .setInputFiles({
        name: "liquidacion-local.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
    await page.getByRole("button", { name: "Revisar archivo" }).click();
    await page
      .getByRole("checkbox", { name: "Importar fila 2", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Importar 1 movimientos seleccionados" })
      .click();
    await page.getByRole("button", { name: "Buscar pagos candidatos" }).click();
    await page
      .getByRole("button", { name: "Confirmar vínculo", exact: true })
      .click();
    await expect(page.getByText("Conciliado", { exact: true })).toBeVisible();
    const sale = await (
      await page.request.get(`/api/v1/orders/${prepared.sale_id}`)
    ).json();
    expect(sale.total_amount).toBe("100.00");
    expect(sale.payments[0].amount_amount).toBe("100.00");
    const stock = await (
      await page.request.get("/api/v1/inventory/stock")
    ).json();
    const productStock = stock.find(
      (row: { product_id: string }) => row.product_id === prepared.product.id,
    );
    expect(productStock.stock_on_hand).toBe(0);
    expect(productStock.reserved_quantity).toBe(0);
    await logoutThroughUi(page);
  });
});
