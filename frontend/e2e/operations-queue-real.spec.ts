import { expect, test } from "./fixtures";
import {
  createTenantThroughUi,
  integrationEnabled,
  logoutThroughUi,
} from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

test.describe("cola operativa con API, Postgres y RLS reales", () => {
  test.skip(
    !integrationEnabled(),
    "Requiere un stack efímero local de integración",
  );
  test("reúne cuatro fuentes reales y deja los cambios en el módulo de origen", async ({
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
    await createTenantThroughUi(page, "queue-real");
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
        name: "Cliente de pendientes reales",
        phone: null,
        email: null,
        is_active: true,
      });
      const serviceCase = await post("/service-cases", {
        customer_id: customer.id,
        title: "Revisar acuerdo de entrega desde la cola",
        note: "Nota privada que no pertenece a la cola",
        due_at: "2020-10-19T12:00:00Z",
      });
      const opportunity = await post("/crm/opportunities", {
        customer_id: customer.id,
        title: "Revisar propuesta del próximo evento",
        estimated_amount: "0.00",
        next_action: "Confirmar disponibilidad",
        due_at: null,
      });
      const followup = await post("/crm/followups", {
        customer_id: customer.id,
        title: "Seguimiento interno de la compra",
        note: "Nota privada fuera de la proyección",
        due_at: new Date(Date.now() + 86400000).toISOString(),
      });
      const resource = await post("/appointments/resources", {
        name: "Atención local de agenda",
        timezone: "America/Mexico_City",
      });
      const appointment = await post("/appointments", {
        resource_id: resource.id,
        customer_id: customer.id,
        title: "Revisar una cita vigente de la cola",
        starts_at: new Date(Date.now() + 3600000).toISOString(),
        ends_at: new Date(Date.now() + 7200000).toISOString(),
        note: "Nota privada de agenda",
      });
      const remindersResponse = await fetch("/api/v1/appointments/reminders", {
        credentials: "include",
        cache: "no-store",
      });
      if (!remindersResponse.ok)
        throw new Error(`Recordatorios locales: ${remindersResponse.status}`);
      const reminders = await remindersResponse.json();
      const reminder = reminders.items.find(
        (row: { appointment_id: string }) =>
          row.appointment_id === appointment.id,
      );
      if (!reminder)
        throw new Error(
          "La cita local debe generar un recordatorio vigente disponible",
        );
      return {
        case_id: serviceCase.id,
        opportunity_id: opportunity.id,
        followup_id: followup.id,
        reminder_id: reminder.id,
      };
    }, signup.dev_verification_token);
    const queueRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/operations/queue")
        queueRequests.push(request.method());
    });
    await page.goto("/operations-queue");
    for (const title of [
      "Revisar acuerdo de entrega desde la cola",
      "Revisar propuesta del próximo evento",
      "Seguimiento interno de la compra",
      "Revisar una cita vigente de la cola",
    ])
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      page.getByText("Nota privada que no pertenece a la cola"),
    ).toHaveCount(0);
    const initial = await (
      await page.request.get("/api/v1/operations/queue")
    ).json();
    const ids: Record<string, string> = {
      service_cases: prepared.case_id,
      opportunities: prepared.opportunity_id,
      followups: prepared.followup_id,
      appointment_reminders: prepared.reminder_id,
    };
    expect(initial.sections).toHaveLength(4);
    for (const section of initial.sections) {
      expect(section.items).toHaveLength(1);
      expect(section.items[0].source_id).toBe(ids[section.source]);
      expect(section.has_more).toBe(false);
    }
    const links = [
      {
        path: "/service-cases",
        parameter: "case_id",
        id: prepared.case_id,
        endpoint: "/api/v1/service-cases",
        title: "Revisar acuerdo de entrega desde la cola",
        detail: "Detalle de atención",
      },
      {
        path: "/crm",
        parameter: "opportunity_id",
        id: prepared.opportunity_id,
        endpoint: "/api/v1/crm/opportunities",
        title: "Revisar propuesta del próximo evento",
        detail: "Registro del enlace",
      },
      {
        path: "/followups",
        parameter: "task_id",
        id: prepared.followup_id,
        endpoint: "/api/v1/crm/followups",
        title: "Seguimiento interno de la compra",
        detail: "Registro del enlace",
      },
      {
        path: "/appointments",
        parameter: "reminder_id",
        id: prepared.reminder_id,
        endpoint: "/api/v1/appointments/reminders",
        title: "Revisar una cita vigente de la cola",
        detail: "Registro del enlace",
      },
    ];
    const navigationRequests: string[] = [];
    const captureNavigation = (request: {
      url: () => string;
      method: () => string;
    }) => {
      if (new URL(request.url()).pathname.startsWith("/api/v1/"))
        navigationRequests.push(request.method());
    };
    page.on("request", captureNavigation);
    for (const linked of links) {
      await page
        .getByRole("link", {
          name: `Abrir registro: ${linked.title}`,
          exact: true,
        })
        .click();
      expect(new URL(page.url()).pathname).toBe(linked.path);
      expect(new URL(page.url()).searchParams.get(linked.parameter)).toBe(
        linked.id,
      );
      await expect(
        page
          .getByRole("region", { name: linked.detail })
          .getByRole("heading", { name: linked.title, exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: linked.detail })
          .getByRole("heading", { name: linked.title, exact: true }),
      ).toBeVisible();
      const current = await page.request.get(`${linked.endpoint}/${linked.id}`);
      expect(current.status()).toBe(200);
      expect((await current.json()).version).toBe(1);
      await page.goto("/operations-queue");
      await expect(
        page.getByRole("link", {
          name: `Abrir registro: ${linked.title}`,
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.goto(`/appointments?reminder_id=${crypto.randomUUID()}`);
    await expect(
      page
        .getByRole("region", { name: "Registro del enlace" })
        .getByRole("alert"),
    ).toHaveText(/no está disponible/);
    await expect(
      page
        .getByRole("region", { name: "Registro del enlace" })
        .getByRole("button", { name: "Registrar revisión del recordatorio" }),
    ).toHaveCount(0);
    await page.goto("/operations-queue");
    expect(navigationRequests.every((method) => method === "GET")).toBe(true);
    page.off("request", captureNavigation);
    await page.getByRole("button", { name: "Actualizar pendientes" }).click();
    await expect(
      page.getByRole("button", { name: "Actualizar pendientes" }),
    ).toBeVisible();
    await page
      .getByRole("link", {
        name: "Abrir registro: Revisar acuerdo de entrega desde la cola",
      })
      .click();
    expect(new URL(page.url()).pathname).toBe("/service-cases");
    await expect(
      page.getByRole("region", { name: "Detalle de atención" }),
    ).toBeVisible();
    const before = await (
      await page.request.get(`/api/v1/service-cases/${prepared.case_id}/events`)
    ).json();
    expect(before.items).toHaveLength(1);
    await page
      .getByRole("button", { name: "Revisar estado y responsable" })
      .click();
    await page
      .getByLabel("Nuevo estado de la atención")
      .selectOption("resolved");
    await page
      .getByRole("button", { name: "Confirmar cambios", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirmar cambios", exact: true }),
    ).toHaveCount(0);
    await page.goto("/operations-queue");
    await expect(
      page.getByText("No hay atenciones activas en esta consulta."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Revisar acuerdo de entrega desde la cola",
      }),
    ).toHaveCount(0);
    for (const title of [
      "Revisar propuesta del próximo evento",
      "Seguimiento interno de la compra",
      "Revisar una cita vigente de la cola",
    ])
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const history = await (
      await page.request.get(`/api/v1/service-cases/${prepared.case_id}/events`)
    ).json();
    expect(history.items).toHaveLength(2);
    expect(history.items.map((item: { kind: string }) => item.kind)).toEqual([
      "updated",
      "created",
    ]);
    const after = await (
      await page.request.get("/api/v1/operations/queue")
    ).json();
    expect(
      after.sections.find(
        (section: { source: string }) => section.source === "service_cases",
      ).items,
    ).toEqual([]);
    for (const source of [
      "opportunities",
      "followups",
      "appointment_reminders",
    ]) {
      const section = after.sections.find(
        (section: { source: string }) => section.source === source,
      );
      expect(section.items[0].source_id).toBe(ids[source]);
      expect(section.items[0].version).toBe(1);
    }
    await page.goto(`/appointments?reminder_id=${prepared.reminder_id}`);
    await expect(
      page
        .getByRole("region", { name: "Registro del enlace" })
        .getByRole("heading", { name: "Revisar una cita vigente de la cola" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Reprogramar Revisar una cita vigente de la cola",
        exact: true,
      })
      .click();
    const nextDate = new Date(Date.now() + 3 * 86400000).toLocaleDateString(
      "en-CA",
      { timeZone: "America/Mexico_City" },
    );
    await page.getByLabel("Inicio de la cita").fill(`${nextDate}T10:00`);
    await page.getByLabel("Fin de la cita").fill(`${nextDate}T11:00`);
    const rescheduled = page.waitForResponse(
      (response) =>
        response.url().endsWith("/reschedule") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirmar nuevo horario", exact: true })
      .click();
    expect((await rescheduled).status()).toBe(200);
    await expect(
      page
        .getByRole("region", { name: "Registro del enlace" })
        .getByRole("alert"),
    ).toHaveText(/no está disponible/);
    await expect(
      page
        .getByRole("region", { name: "Registro del enlace" })
        .getByRole("button", { name: "Registrar revisión del recordatorio" }),
    ).toHaveCount(0);
    const staleReminder = await page.request.get(
      `/api/v1/appointments/reminders/${prepared.reminder_id}`,
    );
    expect(staleReminder.status()).toBe(404);
    const afterReschedule = await (
      await page.request.get("/api/v1/operations/queue")
    ).json();
    expect(
      afterReschedule.sections.find(
        (section: { source: string }) =>
          section.source === "appointment_reminders",
      ).items,
    ).toEqual([]);
    expect(queueRequests.length).toBeGreaterThan(0);
    expect(queueRequests.every((method) => method === "GET")).toBe(true);
    await logoutThroughUi(page);
  });
});
