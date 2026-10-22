import { expect, test } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

const opportunity = {
  id: "11111111-2222-4333-8444-555555555555",
  customer_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  customer_name: "Cliente del enlace verificado",
  title: "Solicitud del catálogo",
  stage: "new",
  estimated_amount: "0.00",
  assigned_user_id: null,
  next_action: "Preparar cotización",
  due_at: null,
  note: null,
  version: 1,
  created_at: "2026-10-21T12:00:00Z",
  updated_at: "2026-10-21T12:00:00Z",
};
const crm = {
  opportunities: [],
  consents: [],
  capabilities: { whatsapp: "not_connected", email: "not_connected" },
  opportunities_has_more: false,
  consents_has_more: false,
};

for (const width of [1440, 390, 320]) {
  test(`a converted catalog request opens a linked quote draft without writes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await markFirstUseToursSeen(page);
    const writes: string[] = [];
    page.on("request", request => {
      if (/\/api\/v1\/(crm|quotes)(?:[/?]|$)/.test(request.url()) && request.method() !== "GET") {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
      authenticated: true,
      user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
      tenant_id: "tenant-1", tenant_name: "Negocio de prueba",
    } }));
    await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
      plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
      subscription: null,
      access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null, blocked_at: null, recovery_path: "/settings/billing" },
    } }));
    await page.route("**/api/v1/crm/requests?**", route => route.fulfill({ json: {
      requests: [{
        id: "22222222-3333-4444-8555-666666666666",
        name: opportunity.customer_name,
        contact: "qa@example.invalid",
        message: "Una consulta ya revisada",
        product_ids: [],
        status: "converted",
        customer_id: opportunity.customer_id,
        opportunity_id: opportunity.id,
        version: 2,
        created_at: opportunity.created_at,
      }],
      has_more: false,
    } }));
    await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/crm?**", route => route.fulfill({ json: crm }));
    await page.route(`**/api/v1/crm/opportunities/${opportunity.id}`, route => route.fulfill({ json: opportunity }));
    await page.route("**/api/v1/quotes?**", route => route.fulfill({ json: { items: [], total: 0 } }));
    await page.route("**/api/v1/catalog/products", route => route.fulfill({ json: [] }));

    await page.goto("/commercial-requests");
    await page.getByRole("link", { name: /Ver oportunidad/ }).click();
    await expect(page).toHaveURL(new RegExp(`/crm\\?opportunity_id=${opportunity.id}$`));
    await page.getByRole("link", { name: /Preparar cotización/ }).click();
    await expect(page.getByRole("heading", { name: "Prepara la propuesta" })).toBeVisible();
    await expect(page.getByLabel("Cliente registrado", { exact: true })).toHaveValue(opportunity.customer_id);
    await expect(page.getByLabel("Oportunidad de origen (opcional)")).toHaveValue(opportunity.id);
    await expect(page.getByRole("option", { name: opportunity.customer_name, exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Crear cotización", exact: true })).toBeDisabled();
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath("linked-quote-draft.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Cerrar formulario", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Prepara la propuesta" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Nueva cotización", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prepara la propuesta" })).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}
