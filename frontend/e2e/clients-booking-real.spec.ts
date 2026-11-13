import axe from "axe-core";
import { expect, test } from "./fixtures";
import { integrationEnabled } from "./integration-helpers";
import { markFirstUseToursSeen } from "./helpers";
import type { Page } from "./fixtures";

async function post(page: Page, path: string, body: unknown) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "csrf_token")?.value;
  const response = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: new URL(
        page.url() === "about:blank" ? "http://127.0.0.1:5174" : page.url(),
      ).origin,
      "Idempotency-Key": crypto.randomUUID(),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    data: body,
  });
  expect(response.ok(), `POST ${path}: ${response.status()}`).toBeTruthy();
  return response.json();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.describe("Clientes, tarjeta visual y reserva pública con API/PostgreSQL/RLS reales", () => {
  test.skip(
    !integrationEnabled(),
    "Requiere API y PostgreSQL locales desechables",
  );
  for (const width of [390, 1440]) {
    test(`programa y reservas sin anticipo a ${width}px`, async ({
      page,
      browser,
      baseURL,
    }) => {
      test.setTimeout(120_000);
      expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const email = `clients-${width}-${crypto.randomUUID()}@example.com`;
      const password = "Kova-Test-Only-2026!";
      const signup = await post(page, "/auth/signup", {
        email,
        password,
        tenant_name: `Estudio local ${width}`,
        accepted_terms: true,
      });
      await post(page, "/auth/verify", {
        token: signup.dev_verification_token,
      });
      await post(page, "/auth/login", { email, password });
      await markFirstUseToursSeen(page, signup.tenant_id);
      await post(page, "/customers", {
        name: "Ana cliente local",
        phone: "5512345678",
        email: null,
        is_active: true,
      });

      await page.goto("/loyalty");
      await page
        .getByRole("button", { name: "Crear mi tarjeta", exact: true })
        .click();
      await page
        .getByLabel("Color de tu tarjeta", { exact: true })
        .fill("#ddccaa");
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
      await page.getByLabel("Por cada compra de (MXN)").fill("100.00");
      await page.getByLabel("El cliente suma estos puntos").fill("5");
      await expect(page.getByText("5 puntos por cada $100.00")).toBeVisible();
      await expect(
        page.getByLabel("Diseño de tu tarjeta", { exact: true }),
      ).toHaveCSS("background-color", "rgb(221, 204, 170)");
      await noOverflow(page);
      await page.screenshot({
        path: `/tmp/kova-clients-lealtad-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
      await page.getByLabel("Ofrecer una recompensa en caja").check();
      await page
        .getByLabel("Nombre de la recompensa")
        .fill("Beneficio de próxima visita");
      await page.getByLabel("Puntos para canjear", { exact: true }).fill("50");
      await page.getByLabel("Descuento en MXN", { exact: true }).fill("25.00");
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
      await page.getByLabel("Activar acumulación de puntos").check();
      await page
        .getByRole("button", { name: "Guardar tarjeta y programa" })
        .click();
      await expect(
        page.getByText(
          "Programa guardado. Tus tarjetas ya muestran estos cambios.",
        ),
      ).toBeVisible();
      const program = await (
        await page.request.get("/api/v1/loyalty/program")
      ).json();
      expect(program.appearance.color).toBe("#DDCCAA");
      expect(program.policy.points_per_step).toBe(5);

      await page.goto("/appointments");
      await page
        .getByRole("button", { name: "Agregar persona o espacio", exact: true })
        .click();
      await page
        .getByLabel("Nombre de la persona o espacio")
        .fill("Cabina de Ana");
      await page
        .getByRole("button", { name: "Guardar persona o espacio", exact: true })
        .click();
      await expect(
        page.getByText("Persona o espacio guardado con su zona horaria."),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Agregar servicio", exact: true })
        .click();
      await page
        .getByLabel("Nombre del servicio")
        .fill("Consulta de bienestar");
      await page.getByLabel("Duración en minutos").fill("30");
      await page.getByLabel("Cabina de Ana", { exact: true }).check();
      await page
        .getByRole("button", { name: "Guardar servicio", exact: true })
        .click();
      await expect(page.getByText("Servicio guardado.")).toBeVisible();
      const r = (
        await (await page.request.get("/api/v1/appointments/resources")).json()
      ).items[0];
      await page
        .getByLabel("Persona o espacio", { exact: true })
        .last()
        .selectOption(r.id);
      const date = new Date();
      date.setDate(date.getDate() + 2);
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
      const weekday = [
        "Domingo",
        "Lunes",
        "Martes",
        "Miércoles",
        "Jueves",
        "Viernes",
        "Sábado",
      ][new Date(`${day}T12:00:00Z`).getUTCDay()];
      await page.getByLabel(weekday, { exact: true }).check();
      await page
        .getByRole("button", { name: "Guardar disponibilidad" })
        .click();
      await expect(
        page.getByText(
          "Disponibilidad guardada. Las citas existentes se conservan.",
        ),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Configurar reservas en línea" })
        .click();
      await page
        .getByLabel("Permitir reservas desde el enlace público")
        .check();
      await page
        .getByRole("button", { name: "Guardar reservas en línea" })
        .click();
      await expect(page.getByText("Enlace público activo")).toBeVisible();
      const share = await page
        .getByLabel("Enlace para reservar", { exact: true })
        .inputValue();
      await page
        .getByRole("button", { name: "Configurar agenda", exact: true })
        .click();
      await noOverflow(page);
      await page.screenshot({
        path: `/tmp/kova-clients-agenda-${width}.png`,
        fullPage: true,
      });

      const guest = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      try {
        const customerPage = await guest.newPage();
        await customerPage.emulateMedia({ reducedMotion: "reduce" });
        await customerPage.goto(share);
        await customerPage
          .getByRole("button", { name: /Consulta de bienestar/ })
          .click();
        const dayLabel = new Intl.DateTimeFormat("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${day}T12:00:00Z`));
        await customerPage
          .getByRole("button", { name: dayLabel, exact: true })
          .click();
        await customerPage.getByRole("button", { name: /09:00/ }).click();
        await customerPage
          .getByLabel("Nombre", { exact: true })
          .fill("Cliente invitado local");
        await customerPage
          .getByLabel("Teléfono de contacto")
          .fill("5512345678");
        await noOverflow(customerPage);
        await customerPage.addScriptTag({ content: axe.source });
        const violations = await customerPage.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
        expect(violations).toEqual([]);
        await customerPage.screenshot({
          path: `/tmp/kova-clients-reserva-${width}.png`,
          fullPage: true,
        });
        await customerPage
          .getByRole("button", { name: "Confirmar mi reserva" })
          .click();
        await expect(
          customerPage.getByRole("heading", {
            name: "Tu cita está confirmada",
          }),
        ).toBeVisible();
        const manage = await customerPage
          .getByLabel("Tu enlace privado", { exact: true })
          .inputValue();
        await customerPage
          .getByRole("link", { name: "Ver y gestionar mi cita" })
          .click();
        await expect(
          customerPage.getByText("Confirmada", { exact: true }),
        ).toBeVisible();
        const [download] = await Promise.all([
          customerPage.waitForEvent("download"),
          customerPage
            .getByRole("button", { name: "Agregar a mi calendario" })
            .click(),
        ]);
        expect(download.suggestedFilename()).toBe("mi-cita.ics");
        const response = await page.request.get(
          `/api/v1/appointments/calendar?starts_from=${day}T00:00:00-06:00&starts_until=${day}T23:59:59-06:00`,
        );
        expect(response.ok()).toBe(true);
        const events = (await response.json()).items;
        expect(events).toHaveLength(1);
        expect(events[0].customer_id).toBeNull();
        await page.goto(`/appointments?bookingId=${events[0].id}`);
        await expect(page.getByRole("dialog")).toBeVisible();
        await page
          .getByLabel("Cliente de esta reserva")
          .selectOption({ label: "Ana cliente local" });
        await page
          .getByRole("button", { name: "Continuar con este cliente" })
          .click();
        await expect(page).toHaveURL(/appointmentId=/);
        await customerPage.goto(manage);
        await customerPage.reload();
        await customerPage
          .getByRole("button", { name: "Cancelar cita", exact: true })
          .click();
        await customerPage
          .getByRole("button", { name: "Confirmar cancelación" })
          .click();
        await expect(
          customerPage.getByText("Cancelada", { exact: true }),
        ).toBeVisible();
        await noOverflow(customerPage);
      } finally {
        await guest.close();
      }
    });
  }
});
