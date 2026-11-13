import axe from "axe-core";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./fixtures";
import { integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";

async function post(page: Page, path: string, body: unknown) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "csrf_token",
  )?.value;
  const response = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: "http://127.0.0.1:5174",
      "Idempotency-Key": crypto.randomUUID(),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    data: body,
  });
  expect(response.ok(), `POST ${path}: ${response.status()}`).toBeTruthy();
  return response.json();
}
async function checkPage(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const a = (window as unknown as { axe: typeof axe }).axe;
    return (
      await a.run("main", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })
    ).violations;
  });
  expect(violations).toEqual([]);
}
test.describe("Mesas sin duración: solicitudes y confirmación con PostgreSQL/RLS reales", () => {
  test.skip(
    !integrationEnabled(),
    "Requiere stack efímero local con PostgreSQL",
  );
  for (const width of [390, 1440]) {
    test(`cinco mesas, solicitud, confirmación y nueva solicitud a ${width}px`, async ({
      page,
      browser,
      baseURL,
    }) => {
      test.setTimeout(120_000);
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const email = `tables-${crypto.randomUUID()}@example.com`,
        password = "Kova-Test-Only-2026!";
      const account = await post(page, "/auth/signup", {
        email,
        password,
        tenant_name: `Cafetería local ${width}`,
        accepted_terms: true,
      });
      await post(page, "/auth/verify", {
        token: account.dev_verification_token,
      });
      await post(page, "/auth/login", { email, password });
      await markFirstUseToursSeen(page, account.tenant_id);
      await page.goto("/appointments");
      for (let i = 1; i <= 5; i++) {
        // During the resource refresh the duplicate action inside <details>
        // can fold. Target the header's stable form control instead.
        await page
          .getByRole("button", {
            name: "Agregar persona o espacio",
            exact: true,
          })
          .and(page.locator('[aria-controls="appointment-resource-form"]'))
          .click();
        await page.getByLabel("Tipo", { exact: true }).selectOption("table");
        await page
          .getByLabel("Nombre de la persona o espacio", { exact: true })
          .fill(`Mesa ${i}`);
        const saved = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/v1/appointments/resources" &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", {
            name: "Guardar persona o espacio",
            exact: true,
          })
          .click();
        expect((await saved).ok()).toBe(true);
        await expect(
          page.getByLabel("Nombre de la persona o espacio", { exact: true }),
        ).toHaveCount(0);
      }
      const resources = (
        await (await page.request.get("/api/v1/appointments/resources")).json()
      ).items;
      expect(resources).toHaveLength(5);
      expect(resources.every((r: { kind: string }) => r.kind === "table")).toBe(
        true,
      );
      const availability = page.getByRole("region", {
        name: "Disponibilidad para reservar",
      });
      for (const resource of resources) {
        await availability
          .getByLabel("Persona o espacio", { exact: true })
          .selectOption(resource.id);
        // Explicit local schedules, matching the user's Monday-Sunday 09:00-18:00 configuration.
        for (const day of [
          "Lunes",
          "Martes",
          "Miércoles",
          "Jueves",
          "Viernes",
          "Sábado",
          "Domingo",
        ]) {
          await availability
            .getByRole("checkbox", { name: day, exact: true })
            .check();
          await availability
            .getByLabel(`Inicio · ${day}`, { exact: true })
            .fill("09:00");
          await availability
            .getByLabel(`Fin · ${day}`, { exact: true })
            .fill("18:00");
        }
        const saved = page.waitForResponse(
          (r) =>
            r.url().includes(`/availability/${resource.id}`) &&
            r.request().method() === "PUT",
        );
        await availability
          .getByRole("button", { name: "Guardar disponibilidad", exact: true })
          .click();
        expect((await saved).ok()).toBe(true);
        await expect(
          availability
            .getByRole("status")
            .filter({ hasText: "Disponibilidad guardada" }),
        ).toBeVisible();
      }
      const publication = page.getByRole("region", {
        name: "Reservas en línea",
        exact: true,
      });
      await publication
        .getByRole("button", {
          name: "Configurar reservas en línea",
          exact: true,
        })
        .click();
      await publication
        .getByLabel("¿Qué podrán reservar?", { exact: true })
        .selectOption("tables");
      await publication
        .getByLabel("Permitir reservas desde el enlace público", {
          exact: true,
        })
        .check();
      const publish = page.waitForResponse(
        (r) =>
          r.url().endsWith("/booking-page") && r.request().method() === "PUT",
      );
      await publication
        .getByRole("button", { name: "Guardar reservas en línea", exact: true })
        .click();
      expect((await publish).ok()).toBe(true);
      const url = await publication
        .getByLabel("Enlace para reservar", { exact: true })
        .inputValue();
      await expect(
        page.getByRole("region", { name: "Servicios para reservar" }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `/tmp/kova-tables-agenda-${width}.png`,
        fullPage: true,
      });

      const publicContext = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      try {
        const visitor = await publicContext.newPage();
        await visitor.goto(url);
        await expect(
          visitor.getByRole("heading", {
            name: "Solicita una mesa",
            exact: true,
          }),
        ).toBeVisible();
        await expect(visitor.getByLabel(/salida|duración/)).toHaveCount(0);
        const target = new Date(Date.now() + 2 * 86400000);
        const date = target.toLocaleDateString("en-CA", {
          timeZone: "America/Mexico_City",
        });
        const dayLabel = new Intl.DateTimeFormat("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${date}T12:00:00Z`));
        if (
          !(await visitor
            .getByRole("button", { name: dayLabel, exact: true })
            .count())
        ) {
          await visitor
            .getByRole("button", { name: "Mes siguiente", exact: true })
            .click();
        }
        await visitor
          .getByRole("button", { name: dayLabel, exact: true })
          .click();
        await visitor.getByRole("button", { name: /09:00/ }).click();
        await visitor
          .getByLabel("Tu nombre", { exact: true })
          .fill("Ana visitante local");
        await visitor
          .getByLabel("Teléfono de contacto", { exact: true })
          .fill("5512345678");
        await visitor
          .getByLabel("¿Cuántas personas vendrán?", { exact: true })
          .fill("4");
        await checkPage(visitor);
        await visitor.screenshot({
          path: `/tmp/kova-tables-public-${width}.png`,
          fullPage: true,
        });
        const sent = visitor.waitForResponse(
          (r) =>
            r.url().endsWith("/table-requests") &&
            r.request().method() === "POST",
        );
        await visitor
          .getByRole("button", { name: "Solicitar mesa", exact: true })
          .click();
        const response = await sent;
        expect(response.status()).toBe(201);
        const receipt = await response.json();
        expect(receipt.status).toBe("requested");
        expect(receipt).not.toHaveProperty("ends_at");
        await expect(visitor.getByRole("status")).toHaveText(
          "Pendiente de confirmación",
        );
        await visitor
          .getByRole("link", {
            name: "Consultar mi solicitud y guardar enlace privado",
            exact: true,
          })
          .click();
        await expect(
          visitor.getByRole("heading", {
            name: "Tu solicitud de mesa",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          visitor.getByRole("button", {
            name: "Descargar llegada al calendario",
          }),
        ).toHaveCount(0);

        await page
          .getByRole("button", { name: "Actualizar solicitudes", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Revisar solicitud de Ana visitante local",
            exact: true,
          })
          .click();
        const detail = page.getByRole("dialog", {
          name: "Solicitud de mesa",
          exact: true,
        });
        await detail
          .getByLabel("Mesa para esta reserva", { exact: true })
          .selectOption({ label: "Mesa 1" });
        await detail
          .getByRole("button", { name: "Confirmar esta mesa", exact: true })
          .click();
        await expect(
          detail.getByText("Reserva confirmada", { exact: true }).first(),
        ).toBeVisible();
        await expect(
          detail.getByText(/Contacta al cliente para avisarle/),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: "Actualizar solicitudes",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          page.getByRole("button", {
            name: "Actualizar solicitudes",
            exact: true,
          }),
        ).toHaveCSS("opacity", "1");
        await checkPage(page);
        await visitor
          .getByRole("button", { name: "Actualizar estado", exact: true })
          .click();
        await expect(
          visitor.getByRole("heading", {
            name: "Reserva confirmada",
            exact: true,
          }),
        ).toBeVisible();
        const download = visitor.waitForEvent("download");
        await visitor
          .getByRole("button", {
            name: "Descargar llegada al calendario",
            exact: true,
          })
          .click();
        const path = await (await download).path();
        expect(path).toBeTruthy();
        const calendar = await readFile(path!, "utf8");
        expect(calendar).toContain("DTSTART:");
        expect(calendar).not.toContain("DTEND:");
        expect(calendar).not.toContain("kova-table-manage");

        await visitor
          .getByRole("button", { name: "Solicitar otra hora", exact: true })
          .click();
        if (
          !(await visitor
            .getByRole("button", { name: dayLabel, exact: true })
            .count())
        ) {
          await visitor
            .getByRole("button", { name: "Mes siguiente", exact: true })
            .click();
        }
        await visitor
          .getByRole("button", { name: dayLabel, exact: true })
          .click();
        await visitor.getByRole("button", { name: /9:15/ }).click();
        await visitor
          .getByRole("button", { name: "Enviar nueva solicitud", exact: true })
          .click();
        await expect(
          visitor
            .getByRole("status")
            .filter({ hasText: "Pendiente de confirmación" }),
        ).toBeVisible();
        await expect(
          visitor.getByText(/El negocio debe volver a confirmar la mesa/),
        ).toBeVisible();
        await visitor
          .getByRole("button", { name: "Cancelar solicitud", exact: true })
          .click();
        await visitor
          .getByRole("button", { name: "Sí, cancelar solicitud", exact: true })
          .click();
        await expect(
          visitor.getByRole("heading", { name: "Cancelada", exact: true }),
        ).toBeVisible();
        const records = await (
          await page.request.get("/api/v1/appointments/table-reservations")
        ).json();
        expect(records.items).toHaveLength(1);
        expect(records.items[0]).toMatchObject({
          status: "cancelled",
          resource_id: null,
          party_size: 4,
        });
        expect(
          await (await page.request.get("/api/v1/customers")).json(),
        ).toHaveLength(0);
        expect(
          (await (await page.request.get("/api/v1/orders")).json()).total,
        ).toBe(0);
      } finally {
        await publicContext.close();
      }
    });
  }
});
