import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AppointmentsView from "./AppointmentsView";
const session = vi.hoisted(() => ({
  role: "owner",
  branch: "branch-1",
  mode: "online",
}));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: session.role },
      tenantId: "tenant-1",
      sessionMode: session.mode,
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => session.branch,
}));
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const resource = {
  id: "resource-1",
  name: "Atención de Ana",
  timezone: "America/Mexico_City",
  is_active: true,
  version: 4,
};
const customer = { id: "customer-1", name: "Cliente real" };
const appointment = {
  id: "appointment-1",
  resource_id: resource.id,
  resource_name: resource.name,
  timezone: resource.timezone,
  customer_id: customer.id,
  customer_name: customer.name,
  title: "Consulta de productos",
  starts_at: "2099-10-20T16:00:00Z",
  ends_at: "2099-10-20T17:00:00Z",
  note: null,
  status: "scheduled",
  version: 3,
  created_at: "2026-10-19T12:00:00Z",
  updated_at: "2026-10-19T12:00:00Z",
};
const route = async (url: RequestInfo | URL) =>
  String(url).includes("/resources")
    ? json({ items: [resource] })
    : String(url).includes("/customers?")
      ? json([customer])
      : String(url).includes("/reminders")
        ? json({ items: [], has_more: false })
        : json({ items: [appointment], has_more: false });
beforeEach(() => {
  vi.clearAllMocks();
  session.role = "owner";
  session.branch = "branch-1";
  session.mode = "online";
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(route);
});
it("creates a booking using the selected resource zone, never the device clock", async () => {
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Nueva cita" }));
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Recurso de la cita"), {
    target: { value: resource.id },
  });
  fireEvent.change(screen.getByLabelText("Cliente de la cita"), {
    target: { value: customer.id },
  });
  fireEvent.change(screen.getByLabelText("Motivo de la cita"), {
    target: { value: "Consulta de sabores" },
  });
  fireEvent.change(screen.getByLabelText("Inicio de la cita"), {
    target: { value: "2099-10-20T10:30" },
  });
  fireEvent.change(screen.getByLabelText("Fin de la cita"), {
    target: { value: "2099-10-20T11:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cita" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/appointments" &&
          init?.body ===
            JSON.stringify({
              resource_id: resource.id,
              customer_id: customer.id,
              title: "Consulta de sabores",
              starts_at: "2099-10-20T16:30:00.000Z",
              ends_at: "2099-10-20T17:30:00.000Z",
              note: null,
            }),
      ),
    ).toBe(true),
  );
  const mutation = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST",
  )![1]!;
  expect(mutation.credentials).toBe("include");
  expect(mutation.headers).toMatchObject({
    "X-Kova-Expected-Tenant": "tenant-1",
    "X-Kova-Branch": "branch-1",
    "Idempotency-Key": expect.any(String),
  });
});
it("preserves a new appointment draft when its header action folds and reopens the form", async () => {
  render(<MemoryRouter><AppointmentsView /></MemoryRouter>);
  const action = await screen.findByRole("button", { name: "Nueva cita" });
  fireEvent.click(action);
  await screen.findByRole("option", { name: customer.name });
  const fields = {
    "Recurso de la cita": resource.id,
    "Cliente de la cita": customer.id,
    "Motivo de la cita": "Consulta por confirmar",
    "Inicio de la cita": "2099-10-20T10:00",
    "Fin de la cita": "2099-10-20T11:00",
    "Nota interna de la cita": "Conservar el acuerdo antes de confirmar.",
  };
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(action);
  expect(screen.queryByLabelText("Motivo de la cita")).not.toBeInTheDocument();
  fireEvent.click(action);
  for (const [label, value] of Object.entries(fields)) {
    expect(screen.getByLabelText(label)).toHaveValue(value);
  }
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("reprograms with expected version and keeps resource timezone visible", async () => {
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Reprogramar Consulta de productos",
    }),
  );
  expect(screen.getByLabelText("Inicio de la cita")).toHaveValue(
    "2099-10-20T10:00",
  );
  expect(
    screen.getByText(/La zona del dispositivo no modifica/),
  ).toHaveTextContent("America/Mexico_City");
  fireEvent.change(screen.getByLabelText("Inicio de la cita"), {
    target: { value: "2099-10-21T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Fin de la cita"), {
    target: { value: "2099-10-21T11:00" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar nuevo horario" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/appointments/appointment-1/reschedule" &&
          JSON.parse(String(init?.body)).expected_version === 3,
      ),
    ).toBe(true),
  );
});
it("requires an explicit confirmation to record completion", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("appointments?")
      ? json({
          items: [
            {
              ...appointment,
              starts_at: "2020-10-20T16:00:00Z",
              ends_at: "2020-10-20T17:00:00Z",
            },
          ],
          has_more: false,
        })
      : route(url),
  );
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Registrar atención" }),
  );
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar estado" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/appointments/appointment-1/transition" &&
          init?.body ===
            JSON.stringify({ expected_version: 3, status: "completed" }),
      ),
    ).toBe(true),
  );
});
it("resolves internal reminders without claiming an external message", async () => {
  fetchMock.mockImplementation(async (url, init) =>
    String(url).includes("/reminders")
      ? json(
          init?.method === "POST"
            ? {}
            : {
                items: [
                  {
                    id: "reminder-1",
                    appointment_id: appointment.id,
                    appointment_version: 3,
                    title: "Revisar cita",
                    starts_at: appointment.starts_at,
                    timezone: resource.timezone,
                    status: "pending",
                    due_at: "2099-10-20T14:00:00Z",
                    version: 1,
                  },
                ],
                has_more: false,
              },
        )
      : route(url),
  );
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Registrar revisión del recordatorio",
    }),
  );
  expect(
    await screen.findByText(
      "Recordatorio revisado por el equipo. No se ha enviado un mensaje.",
    ),
  ).toBeVisible();
  const request = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/resolve"),
  );
  expect(request?.[1]?.body).toBe(
    JSON.stringify({ expected_version: 1, status: "completed" }),
  );
});
it("does not fetch agenda for cashiers or offline sessions", () => {
  session.role = "cashier";
  const view = render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  expect(screen.getByText("Acceso de administración")).toBeVisible();
  view.unmount();
  session.role = "manager";
  session.mode = "offline";
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Conéctate para consultar/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps an ambiguous clock out of the API", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/resources")
      ? json({ items: [{ ...resource, timezone: "America/Tijuana" }] })
      : route(url),
  );
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Nueva cita" }));
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Recurso de la cita"), {
    target: { value: resource.id },
  });
  fireEvent.change(screen.getByLabelText("Cliente de la cita"), {
    target: { value: customer.id },
  });
  fireEvent.change(screen.getByLabelText("Motivo de la cita"), {
    target: { value: "Consulta" },
  });
  fireEvent.change(screen.getByLabelText("Inicio de la cita"), {
    target: { value: "2026-11-01T01:30" },
  });
  fireEvent.change(screen.getByLabelText("Fin de la cita"), {
    target: { value: "2026-11-01T03:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cita" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("dos veces");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});

it("keeps future attendance unavailable until the appointment begins", async () => {
  render(
    <MemoryRouter>
      <AppointmentsView />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("button", { name: "Registrar atención" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Registrar inasistencia" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar cita" })).toBeEnabled();
});

it("refreshes an exact reminder after rescheduling its appointment and removes stale actions", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let available = true;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === `/api/v1/appointments/reminders/${id}`)
      return available
        ? json({
            id,
            appointment_id: appointment.id,
            appointment_version: appointment.version,
            title: "Recordatorio vinculado",
            starts_at: appointment.starts_at,
            timezone: resource.timezone,
            status: "pending",
            due_at: "2026-10-19T12:00:00Z",
            version: 1,
          })
        : json({ detail: "Ya no disponible" }, 404);
    if (String(url).endsWith("/reschedule") && init?.method === "POST") {
      available = false;
      return json({ ...appointment, version: 4 });
    }
    return route(url);
  });
  render(
    <MemoryRouter initialEntries={[`/appointments?reminder_id=${id}`]}>
      <AppointmentsView />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("heading", { name: "Recordatorio vinculado" }),
  ).toBeVisible();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Reprogramar Consulta de productos",
    }),
  );
  fireEvent.change(screen.getByLabelText("Inicio de la cita"), {
    target: { value: "2099-10-21T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Fin de la cita"), {
    target: { value: "2099-10-21T11:00" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar nuevo horario" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no está disponible",
  );
  expect(
    screen.queryByRole("heading", { name: "Recordatorio vinculado" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Registrar revisión del recordatorio",
    }),
  ).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(
      ([url]) => url === `/api/v1/appointments/reminders/${id}`,
    ),
  ).toHaveLength(2);
});

it("selects the exact active customer from a link without creating an appointment", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  fetchMock.mockImplementation(async (url) =>
    String(url) === `/api/v1/customers/${id}`
      ? json({ ...customer, id, name: "Cliente del enlace", is_active: true })
      : route(url),
  );
  render(<MemoryRouter initialEntries={[`/appointments?customerId=${id}`]}><AppointmentsView /></MemoryRouter>);
  expect(await screen.findByLabelText("Cliente de la cita")).toHaveValue(id);
  expect(screen.getByRole("option", { name: "Cliente del enlace" })).toBeVisible();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("resolves a linked appointment outside the list and offers its exact customer in Caja", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  fetchMock.mockImplementation(async (url) => {
    if (String(url) === `/api/v1/appointments/${id}`) return json({ ...appointment, id, title: "Servicio fuera del período" });
    if (String(url).includes("appointments?")) return json({ items: [], has_more: false });
    return route(url);
  });
  render(<MemoryRouter initialEntries={[`/appointments?appointmentId=${id}`]}><AppointmentsView /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "Servicio fuera del período" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Cobrar al cliente" })).toHaveAttribute("href", `/register?customerId=${customer.id}&appointmentId=${id}`);
  expect(screen.getByRole("link", { name: "Ver cliente y su historial" })).toHaveAttribute("href", `/customers?customerId=${customer.id}`);
});

it("persists an explicitly selected sale with the appointment version and preserves attendance", async () => {
  const sale = { id: "22222222-2222-4222-8222-222222222222", status: "completed", total_amount: "450.00", refunded_amount: "0.00", created_at: appointment.created_at };
  let saved = false;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/sales?limit=20&offset=0")) return json({ items: [sale], has_more: false });
    if (String(url).endsWith("/sale") && init?.method === "POST") { saved = true; return json({ ...appointment, sale, version: 4 }); }
    if (String(url).includes("appointments?")) return json({ items: [{ ...appointment, sale: saved ? sale : null, version: saved ? 4 : 3 }], has_more: false });
    return route(url);
  });
  render(<MemoryRouter><AppointmentsView /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Vincular venta existente" }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  const select = await screen.findByLabelText("Venta que corresponde a la cita");
  fireEvent.change(select, { target: { value: sale.id } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo de venta" }));
  expect(await screen.findByRole("link", { name: "Ver venta y comprobante" })).toHaveAttribute("href", `/orders/${sale.id}`);
  const mutation = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/sale"));
  expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({ expected_version: 3, sale_order_id: sale.id });
  expect(mutation?.[1]?.headers).toMatchObject({ "Idempotency-Key": expect.any(String), "X-Kova-Branch": "branch-1" });
  expect(screen.getByText("Programada")).toBeVisible();
});

it("shows linked voids and refunds as financial facts separately from attendance", async () => {
  fetchMock.mockImplementation(async (url) => String(url).includes("appointments?")
    ? json({ items: [{ ...appointment, status: "completed", sale: { id: "sale-1", status: "voided", total_amount: "450.00", refunded_amount: "150.00", created_at: appointment.created_at } }], has_more: false })
    : route(url));
  render(<MemoryRouter><AppointmentsView /></MemoryRouter>);
  expect(await screen.findByText(/Venta anulada/)).toBeVisible();
  expect(screen.getByText(/Devoluciones registradas:/)).toHaveTextContent("150");
  expect(screen.getByText("Atendida")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Cobrar al cliente" })).not.toBeInTheDocument();
});
