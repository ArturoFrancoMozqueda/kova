import { expect, test, type Page } from "./fixtures";
import { markFirstUseToursSeen } from "./helpers";

type Locator = ReturnType<Page["locator"]>;

// Visual/interaction acceptance with declared responses only. No form is
// submitted; the real lifecycle has a separate API/Postgres integration suite.
test.beforeEach(async ({ page }) => {
  await markFirstUseToursSeen(page);
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: "user-1", email: "owner@example.com", tenant_id: "tenant-1", role: "owner" },
    tenant_id: "tenant-1",
    tenant_name: "Negocio de prueba",
  } }));
  await page.route("**/api/v1/billing/subscription", route => route.fulfill({ json: {
    plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
    subscription: null,
    access: { allowed: true, reason: "active", trialing: false, trial_ends_at: null, blocked_at: null, recovery_path: "/settings/billing" },
  } }));
  await page.route("**/api/v1/customers?**", route => route.fulfill({ json: [{
    id: "customer-1", name: "Cliente de prueba", email: "test@example.com", phone: null,
    is_active: true, created_at: "2026-10-18T12:00:00Z",
  }] }));
  await page.route("**/api/v1/appointments?**", route => route.fulfill({ json: { items: [], has_more: false } }));
  await page.route("**/api/v1/appointments/resources", route => route.fulfill({ json: { items: [{
    id: "resource-1", name: "Atención del equipo", timezone: "America/Mexico_City", is_active: true, version: 1,
  }] } }));
  await page.route("**/api/v1/appointments/reminders?**", route => route.fulfill({ json: { items: [], has_more: false } }));
  await page.route("**/api/v1/service-cases?**", route => route.fulfill({ json: { items: [], has_more: false } }));
  await page.route("**/api/v1/service-cases/assignees?**", route => route.fulfill({ json: {
    items: [{ user_id: "user-1", email: "owner@example.com", role: "owner" }], has_more: false,
  } }));
  await page.route("**/api/v1/service-cases/references?**", route => route.fulfill({ json: {
    sales: [], customer_orders: [], sales_has_more: false, customer_orders_has_more: false,
  } }));
  await page.route("**/api/v1/crm/followups?**", route => route.fulfill({ json: {
    policy: { enabled: false, review_delay_days: 3, rebuy_delay_days: 30, version: 0 }, tasks: [], has_more: false,
  } }));
  await page.route("**/api/v1/messaging/conversations?**", route => route.fulfill({ json: {
    items: [], has_more: false, channel_status: "not_connected", send_enabled: false,
  } }));
});

const areas = [
  {
    key: "agenda", path: "/appointments", title: "Agenda del negocio", action: "Nueva cita",
    empty: "No hay citas en este período.", form: "appointment-booking-form",
    fields: ["Recurso de la cita", "Cliente de la cita", "Motivo de la cita", "Inicio de la cita", "Fin de la cita", "Nota interna de la cita"],
  },
  {
    key: "atencion", path: "/service-cases", title: "Atención postventa", action: "Nueva atención postventa",
    empty: "No hay atenciones con estos filtros.", form: "service-case-create-form",
    fields: ["Buscar cliente", "Cliente de la atención", "Asunto de la atención", "Nota inicial privada", "Responsable de la atención", "Vencimiento de la atención (opcional)"],
  },
  {
    key: "seguimiento", path: "/followups", title: "Postventa y seguimiento", action: "Registrar incidencia",
    empty: "No hay tareas de postventa en esta página.", form: "followup-incident-form",
    fields: ["Buscar cliente", "Cliente de la incidencia", "Asunto de la incidencia", "Nota interna", "Fecha de seguimiento"],
  },
  {
    key: "bandeja", path: "/inbox", title: "Bandeja de atención", action: "Nueva conversación interna",
    empty: "Todavía no hay conversaciones.", form: "inbox-conversation-form",
    fields: ["Buscar cliente", "Cliente registrado", "Asunto de la conversación"],
  },
] as const;

const selectLabels = new Set([
  "Recurso de la cita", "Cliente de la cita", "Cliente de la atención",
  "Responsable de la atención", "Cliente de la incidencia", "Cliente registrado",
]);

for (const width of [390, 1440]) {
  for (const area of areas) {
    test(`${area.key} shares header actions and accessible forms at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      const businessWrites: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (request.method() !== "GET" && /^\/api\/v1\/(appointments|service-cases|crm\/followups|messaging)(\/|$)/.test(path)) {
          businessWrites.push(`${request.method()} ${path}`);
        }
      });

      await page.goto(area.path);
      const heading = page.getByRole("heading", { name: area.title, level: 1, exact: true });
      await expect(heading).toBeVisible();
      await expect(page.getByRole("heading", { name: area.empty, exact: true })).toBeVisible();
      const header = heading.locator("..").locator("..");
      const action = header.getByRole("button", { name: area.action, exact: true });
      await expect(action).toBeVisible();
      await expect(action).toBeEnabled();
      await expect(action).toHaveAttribute("aria-expanded", "false");
      await expect(action).toHaveAttribute("aria-controls", area.form);
      await noHorizontalOverflow(page);

      await action.click();
      const formAction = header.locator(`button[aria-controls="${area.form}"]`);
      await expect(formAction).toHaveAttribute("aria-expanded", "true");
      const form = page.locator(`form#${area.form}`);
      await expect(form).toBeVisible();
      if (area.key === "agenda") {
        await form.getByRole("combobox", { name: "Recurso de la cita", exact: true }).selectOption("resource-1");
      }
      for (const label of area.fields) {
        const control = selectLabels.has(label)
          ? form.getByRole("combobox", { name: label, exact: true })
          : form.getByLabel(label, { exact: true });
        await labelledFocus(page, control);
      }
      if (area.key === "agenda") {
        await form.getByLabel("Motivo de la cita", { exact: true }).fill("Consulta del menú y disponibilidad");
        await form.getByLabel("Inicio de la cita", { exact: true }).fill("2099-10-25T10:00");
        await form.getByLabel("Fin de la cita", { exact: true }).fill("2099-10-25T10:30");
        await form.getByLabel("Nota interna de la cita", { exact: true }).fill("Nota interna para el equipo. No se envía al cliente.");
      } else if (area.key === "atencion") {
        await form.getByLabel("Asunto de la atención", { exact: true }).fill("Revisar lo ocurrido con el pedido");
        await form.getByLabel("Nota inicial privada", { exact: true }).fill("Registrar contexto y acordar el siguiente paso.");
      } else if (area.key === "seguimiento") {
        await form.getByLabel("Asunto de la incidencia", { exact: true }).fill("Revisar comentario del cliente");
        await form.getByLabel("Nota interna", { exact: true }).fill("Pendiente interno sin contacto externo.");
      } else {
        await form.getByLabel("Asunto de la conversación", { exact: true }).fill("Consulta de productos para un pedido de aniversario");
      }
      await noHorizontalOverflow(page);
      if (area.key === "agenda" || (area.key === "bandeja" && width === 390)) {
        if (area.key === "bandeja") {
          await form.getByLabel("Asunto de la conversación", { exact: true }).press("Home");
        }
        await header.locator("..").scrollIntoViewIfNeeded();
        const screenshot = testInfo.outputPath(`${area.key}-header-form-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach(`${area.key} header and form at ${width}px`, { path: screenshot, contentType: "image/png" });
      }

      const draftLabel = area.key === "agenda" ? "Motivo de la cita"
        : area.key === "atencion" ? "Asunto de la atención"
        : area.key === "seguimiento" ? "Asunto de la incidencia" : "Asunto de la conversación";
      const draft = await form.getByLabel(draftLabel, { exact: true }).inputValue();
      // Folding is navigation within the task; it must not submit or discard the draft.
      await formAction.click();
      await expect(header.getByRole("button", { name: area.action, exact: true })).toHaveAttribute("aria-expanded", "false");
      await expect(form).toHaveCount(0);
      await header.getByRole("button", { name: area.action, exact: true }).click();
      await expect(form.getByLabel(draftLabel, { exact: true })).toHaveValue(draft);
      if (area.key === "agenda") {
        await expect(form.getByRole("combobox", { name: "Recurso de la cita", exact: true })).toHaveValue("resource-1");
        await expect(form.getByLabel("Inicio de la cita", { exact: true })).toHaveValue("2099-10-25T10:00");
      }
      await noHorizontalOverflow(page);
      expect(businessWrites).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

async function labelledFocus(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  const id = await control.getAttribute("id");
  expect(id).toBeTruthy();
  const label = page.locator(`label[for="${id}"]`);
  await expect(label).toHaveCount(1);
  await label.click();
  await expect(control).toBeFocused();
  await control.press("Escape");
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
