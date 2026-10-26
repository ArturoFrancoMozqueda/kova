import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import AutomationsView from "./AutomationsView";
import type { AutomationsData } from "./types";

const session = vi.hoisted(() => ({
  role: "owner",
  mode: "online",
  tenantId: "tenant-1",
}));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: session.role },
      tenantId: session.tenantId,
      sessionMode: session.mode,
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => "branch-1",
}));

const rule = {
  template_key: "order_ready",
  title: "Pedido listo",
  description: "Revisar pedido listo para entregar.",
  enabled: false,
  version: 0,
};
const overview = (): AutomationsData => ({
  rules: [{ ...rule }],
  runs: [],
  capabilities: {
    internal_tasks: true,
    external_messaging: false,
    financial_actions: false,
  },
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const fetchMock = vi.fn<typeof fetch>();
const mount = () =>
  render(
    <MemoryRouter>
      <AutomationsView />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  session.role = "owner";
  session.mode = "online";
  session.tenantId = "tenant-1";
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => json(overview()));
});

it("shows a truthful empty state and disconnected messaging", async () => {
  mount();
  expect(
    await screen.findByText("Todo empieza con un cambio real"),
  ).toBeVisible();
  expect(screen.getByText("Mensajería externa sin conectar")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("requires explicit confirmation to activate and sends the current version with identity", async () => {
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method === "PUT"
      ? json({ ...rule, enabled: true, version: 1 })
      : json(overview()),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Activar Pedido listo" }),
  );
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar activación" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(1),
  );
  const [url, init] = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PUT",
  )!;
  expect(url).toBe("/api/v1/automations/rules/order_ready");
  expect(JSON.parse(init!.body as string)).toEqual({
    enabled: true,
    expected_version: 0,
  });
  expect(init!.headers).toMatchObject({
    "X-Kova-Expected-Tenant": "tenant-1",
    "X-Kova-Expected-User": "user-1",
    "X-Kova-Branch": "branch-1",
  });
});

it("reloads a stale rule and asks the owner to review before retrying", async () => {
  let reads = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") return json({ detail: "conflict" }, 409);
    reads++;
    const result = overview();
    if (reads > 1) result.rules[0] = { ...rule, enabled: true, version: 3 };
    return json(result);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Activar Pedido listo" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar activación" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Los datos cambiaron",
  );
  expect(screen.getByText("Versión 3")).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
});

it("does not fetch administrative data for a cashier or offline session", () => {
  session.role = "cashier";
  const view = mount();
  expect(screen.getByText("Acceso de administración")).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
  view.unmount();
  session.role = "owner";
  session.mode = "offline";
  mount();
  expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Seguimiento del negocio" }));
  expect(screen.getByText(/Conéctate para consultar/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("blocks mutations immediately when connectivity drops", async () => {
  mount();
  await screen.findByText("Todo empieza con un cambio real");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  fireEvent(window, new Event("offline"));
  expect(
    screen.getByRole("button", { name: "Activar Pedido listo" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Revisar eventos" }),
  ).toBeDisabled();
});

it("resolves a pending task with its version without executing a financial action", async () => {
  const result = overview();
  result.runs = [
    {
      id: "run-1",
      template_key: "order_ready",
      title: "Contactar pedido PED-001",
      status: "pending",
      entity_id: "order-1",
      entity_type: "customer_order",
      entity_version: 3,
      version: 2,
      created_at: "2026-10-18T12:00:00Z",
      resolved_at: null,
    },
  ];
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method === "POST"
      ? json({ ...result.runs[0], status: "completed", version: 3 })
      : json(result),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Completar Contactar pedido PED-001",
    }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === "/api/v1/automations/runs/run-1/resolve",
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([url]) => url === "/api/v1/automations/runs/run-1/resolve",
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    expected_version: 2,
    status: "completed",
  });
  expect(
    await screen.findByText("Tarea marcada como completada."),
  ).toBeVisible();
});

it("discards pending private responses after changing the business", async () => {
  let finishOld: ((response: Response) => void) | undefined;
  fetchMock.mockImplementation(async (_url, init) => {
    const headers = init?.headers as Record<string, string>;
    if (headers["X-Kova-Expected-Tenant"] === "tenant-1")
      return new Promise<Response>((resolve) => {
        finishOld = resolve;
      });
    const next = overview();
    next.rules[0].title = "Regla del nuevo negocio";
    return json(next);
  });
  const view = mount();
  await waitFor(() => expect(finishOld).toBeDefined());
  session.tenantId = "tenant-2";
  view.rerender(
    <MemoryRouter>
      <AutomationsView />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Regla del nuevo negocio")).toBeVisible();
  const previous = overview();
  previous.rules[0].title = "Información privada anterior";
  finishOld!(json(previous));
  await waitFor(() =>
    expect(
      screen.queryByText("Información privada anterior"),
    ).not.toBeInTheDocument(),
  );
  const firstSignal = fetchMock.mock.calls[0][1]?.signal;
  expect(firstSignal?.aborted).toBe(true);
});

it("keeps overdue service-case rules opt-in and links the actual case without treating the due fingerprint as a case version", async () => {
  const data = overview();
  data.rules = [
    {
      ...rule,
      template_key: "service_case_overdue",
      title: "Revisión de atención vencida",
    },
  ];
  data.runs = [
    {
      id: "run-1",
      template_key: "service_case_overdue",
      title: "Revisar atención",
      status: "pending",
      entity_type: "service_case",
      entity_id: "11111111-1111-4111-8111-111111111111",
      entity_version: 1792400000000000,
      version: 1,
      created_at: "2026-10-19T12:00:00Z",
      resolved_at: null,
    },
  ];
  fetchMock.mockImplementation(async () => json(data));
  mount();
  expect(
    await screen.findByRole("link", { name: "Revisar atención postventa" }),
  ).toHaveAttribute(
    "href",
    "/service-cases?case_id=11111111-1111-4111-8111-111111111111",
  );
  expect(screen.getByRole("button", { name: /Activar/ })).toBeVisible();
  expect(
    screen.queryByText(/Versión del recurso 179240/),
  ).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
    true,
  );
});
