import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const tenantId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const saleId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-10-06T12:00:00Z";

async function shell(page: Page, role = "owner") {
  await page.setViewportSize({ width: 390, height: 844 });
  await markFirstUseToursSeen(page, tenantId);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          id: "user-1",
          email: "owner@kova.test",
          tenant_id: tenantId,
          role,
        },
        tenant_id: tenantId,
        tenant_name: "Panadería Aurora",
      },
    }),
  );
  await page.route("**/api/v1/billing/subscription", (route) =>
    route.fulfill({
      json: {
        subscription: { status: "active" },
        access: {
          allowed: true,
          reason: "active",
          trialing: false,
          recovery_path: "/settings/billing",
        },
      },
    }),
  );
  await page.route("**/api/v1/branches", (route) =>
    route.fulfill({
      json: [
        {
          id: tenantId,
          name: "Sucursal principal",
          address: null,
          created_at: createdAt,
        },
      ],
    }),
  );
  await page.route("**/api/v1/onboarding/state", (route) =>
    route.fulfill({
      json: {
        tenant_id: tenantId,
        completed_count: 0,
        total_count: 0,
        steps: [],
      },
    }),
  );
  await page.route("**/api/v1/settings/business-profile", (route) =>
    route.fulfill({
      json: {
        tenant_id: tenantId,
        public_name: "Panadería Aurora",
        timezone: "America/Mexico_City",
        locale: "es-MX",
        currency: "MXN",
        support_email: null,
        support_phone: null,
      },
    }),
  );
  await page.route("**/api/v1/settings/receipt", (route) =>
    route.fulfill({
      json: {
        tenant_id: tenantId,
        receipt_business_name: "Panadería Aurora",
        footer: null,
        tax_contact_text: null,
        logo_url: null,
        paper_width_mm: 80,
      },
    }),
  );
  await page.route("**/api/v1/telemetry/events", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**/api/v1/telemetry/events/anonymous/session", (route) =>
    route.fulfill({ status: 202, json: {} }),
  );
}

async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}

const customer = {
  id: customerId,
  name: "Ana García",
  email: "ana@example.com",
  phone: "5512345678",
  is_active: true,
  created_at: createdAt,
};

test("mobile owner creates a customer and reviews purchases and refunds", async ({
  page,
}) => {
  await shell(page);
  let customers: (typeof customer)[] = [];
  await page.route(/\/api\/v1\/customers\?/, async (route) =>
    route.fulfill({ json: customers }),
  );
  await page.route("**/api/v1/customers", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      is_active: true,
    });
    customers = [customer];
    await route.fulfill({ status: 201, json: customer });
  });
  await page.route(`**/api/v1/customers/${customerId}/history?*`, (route) =>
    route.fulfill({
      json: {
        customer,
        limit: 50,
        offset: 0,
        has_more: false,
        purchases: [
          {
            id: saleId,
            branch_id: tenantId,
            occurred_at: createdAt,
            status: "completed",
            total_amount: "120.00",
            refunded_amount: "20.00",
          },
        ],
      },
    }),
  );
  await page.goto("/customers");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill(customer.name);
  await page.getByLabel("Correo (opcional)").fill(customer.email);
  await page.getByLabel("Teléfono (opcional)").fill(customer.phone);
  await noOverflow(page);
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText(customer.name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ver compras" }).click();
  await expect(
    page.getByRole("heading", { name: "Compras de Ana García" }),
  ).toBeVisible();
  await expect(page.getByText("Devuelto: $20.00")).toBeVisible();
  await expect(page.getByText("$120.00", { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("cashier can find customers but cannot edit or inspect purchase history", async ({
  page,
}) => {
  await shell(page, "cashier");
  await page.route(/\/api\/v1\/customers\?/, async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: [customer] });
  });
  await page.goto("/customers");
  await expect(page.getByText(customer.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo cliente" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ver compras" })).toHaveCount(
    0,
  );
  await page.getByRole("textbox", { name: "Buscar clientes" }).fill("Ana");
  await noOverflow(page);
});

test("mobile owner creates supplier and purchase then receives only units delivered", async ({
  page,
}) => {
  await shell(page);
  const supplier = {
    id: "supplier-1",
    name: "Molino Aurora",
    contact: "ventas@molino.test",
    is_active: true,
  };
  const purchase = {
    id: "purchase-1",
    branch_id: tenantId,
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    notes: "Entrega semanal",
    status: "pending",
    created_at: createdAt,
    items: [
      {
        id: "item-1",
        product_id: productId,
        product_name: "Harina",
        quantity: 10,
        received_quantity: 0,
        unit_cost: "12.50",
      },
    ],
  };
  let suppliers: (typeof supplier)[] = [];
  let purchases: (typeof purchase)[] = [];
  await page.route("**/api/v1/catalog/products", (route) =>
    route.fulfill({
      json: [
        {
          id: productId,
          tenant_id: tenantId,
          category_id: null,
          name: "Harina",
          sku: "HAR-1",
          barcode: "000123",
          description: null,
          price_amount: "20.00",
          cost_price: "12.50",
          track_inventory: true,
          low_stock_threshold: 5,
          is_active: true,
          image_url: null,
          image_position_x: 50,
          image_position_y: 50,
          image_zoom: 1,
          modifier_groups: [],
        },
      ],
    }),
  );
  await page.route("**/api/v1/purchasing/suppliers", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        name: supplier.name,
        contact: supplier.contact,
      });
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      suppliers = [supplier];
      await route.fulfill({ status: 201, json: supplier });
    } else await route.fulfill({ json: suppliers });
  });
  await page.route(/\/api\/v1\/purchasing\/orders\?/, (route) =>
    route.fulfill({ json: purchases }),
  );
  await page.route("**/api/v1/purchasing/orders", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      supplier_id: supplier.id,
      notes: purchase.notes,
      items: [{ product_id: productId, quantity: 10, unit_cost: "12.50" }],
    });
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    purchases = [purchase];
    await route.fulfill({ status: 201, json: purchase });
  });
  await page.route(
    "**/api/v1/purchasing/orders/purchase-1/receive",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        items: [{ item_id: "item-1", quantity: 4 }],
        update_catalog_cost: true,
      });
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      purchases = [
        {
          ...purchase,
          status: "partial",
          items: [{ ...purchase.items[0], received_quantity: 4 }],
        },
      ];
      await route.fulfill({ json: purchases[0] });
    },
  );
  await page.goto("/purchasing");
  await page.getByLabel("Nombre", { exact: true }).fill(supplier.name);
  await page.getByLabel("Teléfono o correo (opcional)").fill(supplier.contact);
  await page.getByRole("button", { name: "Guardar proveedor" }).click();
  await page.getByLabel("Proveedor", { exact: true }).selectOption(supplier.id);
  await page.getByLabel("Producto", { exact: true }).selectOption(productId);
  await page.getByLabel("Unidades", { exact: true }).fill("10");
  await page.getByLabel("Costo unitario MXN").fill("12.50");
  await page.getByLabel("Referencia o notas (opcional)").fill(purchase.notes);
  await noOverflow(page);
  await page.getByRole("button", { name: "Crear compra pendiente" }).click();
  await expect(
    page.getByText("Harina: 0 de 10 recibidas", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Recibir mercancía" }).click();
  await page.getByLabel("Harina · pendientes 10").fill("4");
  await page
    .getByRole("checkbox", { name: /Actualizar el costo del catálogo/ })
    .check();
  await noOverflow(page);
  await page.getByRole("button", { name: "Confirmar recepción" }).click();
  await expect(
    page.getByText("Molino Aurora · Recibida parcialmente"),
  ).toBeVisible();
  await expect(
    page.getByText("Harina: 4 de 10 recibidas", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Recibir mercancía" }),
  ).toBeEnabled();
});

test("mobile fiscal setup saves a pending request without claiming CFDI issuance", async ({
  page,
}) => {
  await shell(page);
  const issuer = {
    rfc: "AAA010101AAA",
    legal_name: "Panadería Aurora SA",
    postal_code: "06000",
    tax_regime: "601",
  };
  const recipient = {
    rfc: "XAXX010101000",
    legal_name: "Ana García",
    postal_code: "06000",
    tax_regime: "616",
    cfdi_use: "S01",
    email: "ana@example.com",
  };
  let requests: unknown[] = [];
  await page.route("**/api/v1/integrations/readiness", (route) =>
    route.fulfill({
      json: {
        cfdi_status: "not_connected",
        terminal_status: "not_connected",
        can_issue_cfdi: false,
        can_charge_terminal: false,
        issuer: null,
        validation_scope: "format_only",
      },
    }),
  );
  await page.route("**/api/v1/integrations/issuer", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataJSON()).toEqual(issuer);
    await route.fulfill({ json: { issuer } });
  });
  await page.route(/\/api\/v1\/orders\?/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: saleId,
            branch_id: tenantId,
            status: "completed",
            total_amount: "120.00",
            created_at: createdAt,
          },
        ],
        total: 1,
      },
    }),
  );
  await page.route("**/api/v1/integrations/invoice-requests", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        order_id: saleId,
        recipient,
      });
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      const request = {
        id: "invoice-request-1",
        order_id: saleId,
        recipient_snapshot: recipient,
        total_amount: "120.00",
        status: "pending_provider",
        fiscal_status: "not_issued",
        created_at: createdAt,
      };
      requests = [request];
      await route.fulfill({ status: 201, json: request });
    } else await route.fulfill({ json: requests });
  });
  await page.goto("/settings/integrations");
  await expect(
    page.getByRole("button", { name: "Guardar solicitud pendiente" }),
  ).toBeDisabled();
  const issuerSection = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Datos fiscales del negocio" }),
    });
  await issuerSection.getByLabel("RFC", { exact: true }).fill(issuer.rfc);
  await issuerSection
    .getByLabel("Nombre o razón social")
    .fill(issuer.legal_name);
  await issuerSection
    .getByLabel("Código postal fiscal")
    .fill(issuer.postal_code);
  await issuerSection
    .getByLabel("Clave de régimen fiscal")
    .fill(issuer.tax_regime);
  await noOverflow(page);
  await page.getByRole("button", { name: "Guardar datos del negocio" }).click();
  await expect(page.getByText("Datos fiscales guardados.")).toBeVisible();
  const requestSection = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Registrar solicitud de factura",
      }),
    });
  await requestSection.getByLabel("Venta completada").selectOption(saleId);
  await requestSection.getByLabel("RFC", { exact: true }).fill(recipient.rfc);
  await requestSection
    .getByLabel("Nombre o razón social")
    .fill(recipient.legal_name);
  await requestSection
    .getByLabel("Código postal fiscal")
    .fill(recipient.postal_code);
  await requestSection
    .getByLabel("Clave de régimen fiscal")
    .fill(recipient.tax_regime);
  await requestSection.getByLabel("Clave de uso CFDI").fill(recipient.cfdi_use);
  await requestSection.getByLabel("Correo del cliente").fill(recipient.email);
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Guardar solicitud pendiente" })
    .click();
  await expect(
    page.getByText(
      "Solicitud guardada, pendiente de proveedor. La factura no se ha emitido.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Pendiente de proveedor · Sin emitir"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Facturación CFDI · Sin conectar" }),
  ).toBeVisible();
  await expect(
    requestSection
      .getByLabel("Venta completada")
      .locator("option", { hasText: /Folio/ }),
  ).toHaveCount(0);
  await noOverflow(page);
});

test("manager sees fiscal readiness but cannot create requests or expose recipients", async ({
  page,
}) => {
  await shell(page, "manager");
  await page.route("**/api/v1/integrations/readiness", (route) =>
    route.fulfill({
      json: {
        cfdi_status: "not_connected",
        terminal_status: "not_connected",
        can_issue_cfdi: false,
        can_charge_terminal: false,
        issuer: null,
        validation_scope: "format_only",
      },
    }),
  );
  await page.goto("/settings/integrations");
  await expect(
    page.getByText(
      "El administrador debe guardar los datos fiscales del negocio.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Guardar solicitud pendiente" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Solicitudes recientes" }),
  ).toHaveCount(0);
  await noOverflow(page);
});
