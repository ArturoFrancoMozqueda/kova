import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import OperationsQueueView from "./OperationsQueueView";
import type { OperationsQueueData } from "./types";

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
const dataset = (): OperationsQueueData => ({
  generated_at: "2026-10-19T12:00:00Z",
  sections: [
    {
      source: "service_cases",
      items: [
        {
          source_id: "case-1",
          title: "Revisar entrega",
          customer_name: "Cliente real",
          state: "open",
          version: 2,
          due_at: "2020-10-19T10:00:00Z",
          overdue: true,
          route_key: "service_cases",
        },
      ],
      has_more: true,
    },
    {
      source: "opportunities",
      items: [
        {
          source_id: "opp-1",
          title: "Propuesta de evento",
          customer_name: "Otro cliente",
          state: "proposal",
          version: 1,
          due_at: null,
          overdue: false,
          route_key: "crm",
        },
      ],
      has_more: false,
    },
    {
      source: "followups",
      items: [
        {
          source_id: "task-1",
          title: "Revisar observación de la compra",
          customer_name: "Cliente de postventa",
          state: "pending",
          version: 1,
          due_at: "2020-10-19T10:00:00Z",
          overdue: false,
          route_key: "followups",
        },
      ],
      has_more: false,
    },
    {
      source: "appointment_reminders",
      items: [
        {
          source_id: "reminder-1",
          title: "Revisar cita vigente",
          customer_name: "Cliente de cita",
          state: "pending",
          version: 1,
          due_at: "2026-10-19T10:00:00Z",
          overdue: true,
          route_key: "appointments",
        },
      ],
      has_more: false,
    },
  ],
});
const mockData = (data: OperationsQueueData) =>
  fetchMock.mockImplementation(async (url) =>
    json(
      String(url).includes("business-profile")
        ? { timezone: "America/Cancun" }
        : data,
    ),
  );
const queueCalls = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("operations/queue"),
  );
const mount = () =>
  render(
    <MemoryRouter>
      <OperationsQueueView />
    </MemoryRouter>,
  );
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
  mockData(dataset());
});

it.each(["owner", "manager"])(
  "shows four real source sections for %s using scoped reads only",
  async (role) => {
    session.role = role;
    mount();
    expect(
      await screen.findByRole("heading", { name: "Revisar entrega" }),
    ).toBeVisible();
    for (const title of [
      "Atención postventa",
      "Oportunidades comerciales",
      "Seguimiento de clientes",
      "Recordatorios de agenda",
    ])
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/operations/queue");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        "X-Kova-Expected-Tenant": "tenant-1",
        "X-Kova-Expected-User": "user-1",
        "X-Kova-Branch": "branch-1",
      },
    });
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method === "GET"),
    ).toBe(true);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Completar|Resolver|Enviar/ }),
    ).not.toBeInTheDocument();
  },
);
it("does not infer totals from samples or overdue state from the device clock", async () => {
  mount();
  await screen.findByText("Revisar entrega");
  expect(
    screen.getByText("Hay más pendientes de esta área en su módulo de origen."),
  ).toBeVisible();
  expect(
    screen.getByRole("link", {
      name: "Consultar el resto en Atención postventa",
    }),
  ).toHaveAttribute("href", "/service-cases");
  expect(screen.getAllByText(/^Fecha vencida:/)).toHaveLength(2);
  expect(screen.getByText(/^Fecha de seguimiento:/)).toBeVisible();
  expect(screen.getByText("Sin fecha de seguimiento registrada")).toBeVisible();
  expect(
    screen.queryByText(/Total de pendientes|4 pendientes|80 pendientes/),
  ).not.toBeInTheDocument();
});
it("builds only known source links and ignores untrusted route strings", async () => {
  const data = dataset();
  data.sections[0].items[0].route_key =
    "https://outside.invalid/private" as never;
  (data.sections as unknown[]).push({
    source: "loyalty",
    items: [{ title: "Saldo privado del dueño" }],
    has_more: false,
  });
  mockData(data);
  mount();
  await screen.findByText("Revisar entrega");
  expect(screen.queryByText("Saldo privado del dueño")).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("link").map((link) => link.getAttribute("href")),
  ).toEqual(["/service-cases", "/crm", "/followups", "/appointments"]);
  expect(
    screen
      .getAllByRole("link")
      .every((link) => !link.getAttribute("href")?.includes("case-1")),
  ).toBe(true);
});
it("shows individual source empty states without claiming the business has no work", async () => {
  const data = dataset();
  data.sections = data.sections.map((section) => ({
    ...section,
    items: [],
    has_more: false,
  }));
  mockData(data);
  mount();
  expect(
    await screen.findByText("No hay atenciones activas en esta consulta."),
  ).toBeVisible();
  expect(
    screen.getByText(
      "No hay oportunidades abiertas con una próxima acción registrada.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "No hay tareas de seguimiento pendientes en esta consulta.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "No hay recordatorios de citas disponibles por revisar en esta consulta.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(/0 pendientes|Todo al día/),
  ).not.toBeInTheDocument();
});
it("shows a missing source as incomplete instead of inventing an empty result", async () => {
  const data = dataset();
  data.sections = data.sections.filter(
    (section) => section.source !== "followups",
  );
  mockData(data);
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Esta área no apareció en la respuesta",
  );
  expect(
    screen.queryByText(
      "No hay tareas de seguimiento pendientes en esta consulta.",
    ),
  ).not.toBeInTheDocument();
});
it("recovers a failed read through an explicit retry", async () => {
  fetchMock.mockResolvedValueOnce(
    json({ detail: "Consulta temporalmente no disponible" }, 503),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Consulta temporalmente no disponible",
  );
  fireEvent.click(screen.getByRole("button", { name: "Consultar de nuevo" }));
  expect(await screen.findByText("Revisar entrega")).toBeVisible();
  expect(queueCalls()).toHaveLength(2);
});
it("hides the previous sample after a failed refresh", async () => {
  mount();
  await screen.findByText("Revisar entrega");
  fetchMock.mockResolvedValue(
    json({ detail: "Acceso comercial bloqueado" }, 403),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Actualizar pendientes" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Acceso comercial bloqueado",
  );
  expect(screen.queryByText("Revisar entrega")).not.toBeInTheDocument();
});
it("does not fetch private queue data for cashiers or offline sessions", () => {
  session.role = "cashier";
  const view = mount();
  expect(screen.getByText("Acceso de administración")).toBeVisible();
  view.unmount();
  session.role = "owner";
  session.mode = "offline";
  mount();
  expect(screen.getByText(/Conéctate para consultar/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not fetch while the device is offline even with an online session snapshot", () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  mount();
  expect(
    screen.getByText(/La consulta anterior no se muestra sin conexión/),
  ).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("drops offline snapshots and reads fresh data on reconnection", async () => {
  mount();
  await screen.findByText("Revisar entrega");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.queryByText("Revisar entrega")).not.toBeInTheDocument();
  expect(
    screen.getByText(/La consulta anterior no se muestra sin conexión/),
  ).toBeVisible();
  const fresh = dataset();
  fresh.sections[0].items[0].title = "Entrega revisada por la fuente";
  mockData(fresh);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  act(() => window.dispatchEvent(new Event("online")));
  expect(
    await screen.findByText("Entrega revisada por la fuente"),
  ).toBeVisible();
  expect(screen.queryByText("Revisar entrega")).not.toBeInTheDocument();
  expect(queueCalls()).toHaveLength(2);
});
it("aborts the old branch read and rejects its late response", async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async (url, init) =>
    String(url).includes("business-profile")
      ? json({ timezone: "America/Cancun" })
      : (init?.headers as Record<string, string>)["X-Kova-Branch"] ===
          "branch-1"
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve;
          })
        : json({
            ...dataset(),
            sections: dataset().sections.map((section) => ({
              ...section,
              items: [],
              has_more: false,
            })),
          }),
  );
  const view = mount();
  await waitFor(() => expect(resolveOld).toBeDefined());
  const previous = fetchMock.mock.calls[0][1]?.signal;
  session.branch = "branch-2";
  view.rerender(
    <MemoryRouter>
      <OperationsQueueView />
    </MemoryRouter>,
  );
  await screen.findByText("No hay atenciones activas en esta consulta.");
  resolveOld!(json(dataset()));
  await waitFor(() =>
    expect(screen.queryByText("Revisar entrega")).not.toBeInTheDocument(),
  );
  expect(previous?.aborted).toBe(true);
});

it("formats dates in the configured business zone independently of the device", async () => {
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone === "Pacific/Honolulu"
      ? "Asia/Tokyo"
      : "Pacific/Honolulu";
  fetchMock.mockImplementation(async (url) =>
    json(String(url).includes("business-profile") ? { timezone } : dataset()),
  );
  mount();
  const expected = new Date(dataset().generated_at).toLocaleString("es-MX", {
    timeZone: timezone,
  });
  expect(await screen.findByText(`Consulta del ${expected}`)).toBeVisible();
  expect(
    screen.getByText(
      new RegExp(`Fechas en la zona horaria del negocio: ${timezone}`),
    ),
  ).toBeVisible();
  expect(expected).not.toBe(
    new Date(dataset().generated_at).toLocaleString("es-MX"),
  );
  const profileCall = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("business-profile"),
  );
  expect(profileCall?.[1]).toMatchObject({
    credentials: "include",
    headers: {
      "X-Kova-Branch": "branch-1",
      "X-Kova-Expected-Tenant": "tenant-1",
      "X-Kova-Expected-User": "user-1",
    },
  });
});
it.each(["failure", "invalid"])(
  "keeps queue available with an explicit UTC fallback after profile %s",
  async (scenario) => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("business-profile")
        ? scenario === "failure"
          ? json({ detail: "No disponible" }, 503)
          : json({ timezone: "Invalid/Zone" })
        : json(dataset()),
    );
    mount();
    expect(await screen.findByText("Revisar entrega")).toBeVisible();
    expect(
      screen.getByText(
        /No pudimos confirmar la zona horaria del negocio. Las fechas se muestran en UTC/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        `Consulta del ${new Date(dataset().generated_at).toLocaleString("es-MX", { timeZone: "UTC" })}`,
      ),
    ).toBeVisible();
  },
);
