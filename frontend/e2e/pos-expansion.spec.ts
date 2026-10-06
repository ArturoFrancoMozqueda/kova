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
  await page.route("**/api/v1/integrations/cfdi/status", (route) =>
    route.fulfill({
      json: {
        provider: "facturapi",
        storage_available: false,
        connections: [],
      },
    }),
  );
  await page.route("**/api/v1/integrations/cfdi/documents", (route) =>
    route.fulfill({ json: [] }),
  );
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
  const issuerSection = page.locator("section").filter({
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
  const requestSection = page.locator("section").filter({
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
    page.getByText("Solicitud registrada · Consulta el estado del documento"),
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
  const ownerRequests: string[] = [];
  await page.route("**/api/v1/integrations/cfdi/**", async (route) => {
    ownerRequests.push(route.request().url());
    await route.fulfill({ status: 403 });
  });
  await page.route("**/api/v1/integrations/invoice-requests", async (route) => {
    ownerRequests.push(route.request().url());
    await route.fulfill({ status: 403 });
  });
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
  await expect(page.getByLabel("Ambiente fiscal")).toHaveCount(0);
  expect(ownerRequests).toEqual([]);
  await noOverflow(page);
});

test("mobile CFDI Test connects, corrects receiver, previews and reconciles one pending document", async ({
  page,
}) => {
  await shell(page);
  const issuer = {
    rfc: "EKU9003173C9",
    legal_name: "Panadería Aurora SA",
    postal_code: "06000",
    tax_regime: "601",
  };
  const recipient = {
    ...issuer,
    legal_name: "Cliente original",
    cfdi_use: "G03",
    email: "ana@example.com",
  };
  const corrected = {
    ...recipient,
    rfc: "AAA010101AAA",
    legal_name: "Cliente corregido",
  };
  const requestId = "55555555-5555-4555-8555-555555555555";
  const documentId = "66666666-6666-4666-8666-666666666666";
  const lineId = "77777777-7777-4777-8777-777777777777";
  const connection = {
    environment: "test",
    organization_id: "organization-test",
    connected: true,
    issuer_rfc: issuer.rfc,
    production_ready: false,
    certificate_expires_at: null,
  };
  const line = {
    order_item_id: lineId,
    product_name: "Pan de caja",
    quantity: 1,
    unit_price_amount: "116.00",
    discount_amount: "0.00",
    tax_amount: "0.00",
    line_total_amount: "116.00",
  };
  const body = {
    request_id: requestId,
    recipient: corrected,
    environment: "test",
    payment_form: "01",
    lines: [
      {
        order_item_id: lineId,
        product_key: "50181900",
        unit_key: "H87",
        tax_kind: "iva16",
        tax_included: true,
      },
    ],
  };
  const document = {
    id: documentId,
    request_id: requestId,
    order_id: saleId,
    recipient_snapshot: corrected,
    environment: "test",
    state: "pending",
    total_amount: "116.00",
    created_at: createdAt,
    updated_at: createdAt,
    provider_id: "provider-test",
    uuid: null,
    xml_available: false,
    last_error_code: null,
    cancellation_status: null,
  };
  let connected = false;
  let emissions = 0;
  let reconciliations = 0;
  await page.route("**/api/v1/integrations/readiness", (route) =>
    route.fulfill({
      json: {
        cfdi_status: "not_connected",
        terminal_status: "not_connected",
        can_issue_cfdi: false,
        can_charge_terminal: false,
        issuer,
        validation_scope: "format_only",
      },
    }),
  );
  await page.route(/\/api\/v1\/orders\?/, (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route("**/api/v1/integrations/invoice-requests", (route) =>
    route.fulfill({
      json: [
        {
          id: requestId,
          order_id: saleId,
          recipient_snapshot: recipient,
          total_amount: "116.00",
          status: "pending_provider",
          fiscal_status: "not_issued",
          created_at: createdAt,
        },
      ],
    }),
  );
  await page.route("**/api/v1/integrations/cfdi/status", (route) =>
    route.fulfill({
      json: {
        provider: "facturapi",
        storage_available: true,
        connections: connected ? [connection] : [],
      },
    }),
  );
  await page.route("**/api/v1/integrations/cfdi/connection", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataJSON()).toEqual({
      environment: "test",
      api_key: "mock-organization-test",
    });
    connected = true;
    await route.fulfill({ json: connection });
  });
  await page.route(
    `**/api/v1/integrations/cfdi/requests/${requestId}/context`,
    (route) =>
      route.fulfill({
        json: {
          request_id: requestId,
          order_id: saleId,
          issuer,
          recipient,
          total_amount: "116.00",
          discount_amount: "0.00",
          lines: [line],
          payments: [{ method: "cash", amount: "116.00" }],
          suggested_payment_forms: ["01"],
        },
      }),
  );
  await page.route("**/api/v1/integrations/cfdi/preview", async (route) => {
    expect(route.request().postDataJSON()).toEqual(body);
    await route.fulfill({
      json: {
        request_id: requestId,
        order_id: saleId,
        recipient_snapshot: corrected,
        environment: "test",
        subtotal_amount: "100.00",
        discount_amount: "0.00",
        tax_amount: "16.00",
        total_amount: "116.00",
        lines: [
          {
            ...body.lines[0],
            product_name: "Pan de caja",
            quantity: 1,
            unit_price_amount: "100.000000",
            gross_amount: "100.000000",
            discount_amount: "0.000000",
            tax_amount: "16.00",
            total_amount: "116.00",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/integrations/cfdi/documents", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual(body);
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    emissions += 1;
    await route.fulfill({ json: document });
  });
  await page.route(
    `**/api/v1/integrations/cfdi/documents/${documentId}/reconcile`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      reconciliations += 1;
      await route.fulfill({
        json: {
          ...document,
          state: "issued",
          uuid: "88888888-8888-4888-8888-888888888888",
          xml_available: true,
        },
      });
    },
  );
  await page.route(
    `**/api/v1/integrations/cfdi/documents/${documentId}/xml`,
    (route) =>
      route.fulfill({
        contentType: "application/xml",
        body: '<?xml version="1.0"?><TestDocument />',
      }),
  );
  await page.goto("/settings/integrations");
  await expect(page.getByLabel("Ambiente fiscal")).toHaveValue("test");
  await expect(
    page.getByText("Pruebas · Sin validez fiscal", { exact: true }),
  ).toBeVisible();
  const secret = page.getByLabel("Llave de organización Test");
  await expect(secret).toHaveAttribute("type", "password");
  await secret.fill("mock-organization-test");
  await page
    .getByRole("button", { name: "Guardar conexión", exact: true })
    .click();
  await expect(
    page.getByText("Organización conectada · RFC EKU9003173C9"),
  ).toBeVisible();
  await expect(secret).toHaveValue("");
  await page
    .getByRole("button", { name: "Preparar emisión", exact: true })
    .click();
  await expect(page.getByText("Pan de caja · 1 unidades")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Calcular vista previa fiscal" }),
  ).toBeDisabled();
  await page
    .getByLabel("RFC del receptor", { exact: true })
    .fill(corrected.rfc);
  await page.getByLabel("Razón social del receptor").fill(corrected.legal_name);
  await page.getByLabel("Forma de pago SAT").selectOption("01");
  await page.getByLabel("Clave SAT del producto 1").fill("50181900");
  await page.getByLabel("Clave SAT de unidad 1").fill("H87");
  await page.getByLabel("Tratamiento fiscal 1").selectOption("iva16");
  await page.getByLabel("Impuesto en el precio 1").selectOption("included");
  await page
    .getByRole("button", { name: "Calcular vista previa fiscal" })
    .click();
  await expect(
    page.getByText(/Receptor de esta emisión: Cliente corregido/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Emitir documento de prueba" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /Revisé el receptor/ }).check();
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Emitir documento de prueba" })
    .click();
  expect(emissions).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar envío al proveedor" })
    .click();
  await expect(
    page.getByText("Pendiente en el proveedor", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preparar emisión", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Descargar XML" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Consultar estado con proveedor" })
    .click();
  await expect(
    page.getByText("Emitido · UUID confirmado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Test · Sin validez fiscal · $116.00", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar XML" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`test-sin-validez-fiscal-cfdi-${documentId}.xml`);
  expect(await download.failure()).toBeNull();
  expect(emissions).toBe(1);
  expect(reconciliations).toBe(1);
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) =>
        value.includes("mock-organization-test"),
      ),
    ),
  ).toBe(false);
  await noOverflow(page);
});
