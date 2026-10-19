import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import ServiceCasesView from "./ServiceCasesView";
import type { ServiceCase, ServiceCaseEvent } from "./types";
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
const customer = { id: "customer-1", name: "Cliente real" };
const initial = (): ServiceCase => ({
  id: "case-1",
  customer_id: customer.id,
  customer_name: customer.name,
  title: "Revisar entrega del pedido",
  status: "open",
  assigned_user_id: "user-1",
  assignee_active: true,
  due_at: "2020-10-19T10:00:00Z",
  overdue: true,
  version: 3,
  sale_order_id: "sale-1",
  customer_order_id: null,
  created_at: "2020-10-18T12:00:00Z",
  updated_at: "2020-10-19T12:00:00Z",
  resolved_at: null,
});
let record: ServiceCase;
let events: ServiceCaseEvent[];
const route = async (url: RequestInfo | URL) => {
  const path = String(url);
  if (path.includes("/api/v1/customers?"))
    return json([customer, { id: "customer-2", name: "Otro cliente" }]);
  if (path.includes("/assignees"))
    return json({
      items: [
        { user_id: "user-1", email: "owner@example.com", role: "owner" },
        { user_id: "user-2", email: "manager@example.com", role: "manager" },
      ],
    });
  if (path.includes("/references?"))
    return json({
      sales: [
        {
          id: "sale-1",
          total_amount: "100.00",
          occurred_at: "2026-10-19T12:00:00Z",
          status: "completed",
        },
      ],
      customer_orders: [{ id: "order-1", folio: "PED-001", status: "new" }],
      sales_has_more: false,
      customer_orders_has_more: false,
    });
  if (path.includes("/events?"))
    return json({ items: events, has_more: false });
  return json({ items: [record], has_more: false });
};
const mount = () =>
  render(
    <MemoryRouter>
      <ServiceCasesView />
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
  record = initial();
  events = [
    {
      id: "event-1",
      case_id: record.id,
      case_version: 1,
      kind: "created",
      actor_user_id: "user-1",
      status: "open",
      assigned_user_id: null,
      due_at: null,
      note: "Nota inicial que se conserva",
      created_at: "2020-10-18T12:00:00Z",
    },
  ];
  fetchMock.mockImplementation(route);
});
it("allows a manager to create a case with verified customer and one real reference", async () => {
  session.role = "manager";
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Nueva atención postventa" }),
  );
  expect(
    screen.getByRole("button", { name: "Registrar atención" }),
  ).toBeDisabled();
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente de la atención"), {
    target: { value: customer.id },
  });
  await screen.findByRole("option", { name: "PED-001" });
  fireEvent.change(screen.getByLabelText("Asunto de la atención"), {
    target: { value: "Pedido con entrega pendiente" },
  });
  fireEvent.change(screen.getByLabelText("Nota inicial privada"), {
    target: { value: "El cliente solicita revisar la entrega." },
  });
  fireEvent.change(screen.getByLabelText("Responsable de la atención"), {
    target: { value: "user-2" },
  });
  fireEvent.change(screen.getByLabelText("Venta relacionada"), {
    target: { value: "sale-1" },
  });
  fireEvent.change(screen.getByLabelText("Pedido relacionado"), {
    target: { value: "order-1" },
  });
  expect(screen.getByLabelText("Venta relacionada")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Registrar atención" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/service-cases" &&
          init?.body ===
            JSON.stringify({
              customer_id: customer.id,
              title: "Pedido con entrega pendiente",
              note: "El cliente solicita revisar la entrega.",
              assigned_user_id: "user-2",
              due_at: null,
              sale_order_id: null,
              customer_order_id: "order-1",
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
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes("/employees")),
  ).toBe(false);
});
it("requires reviewing a status change and preserves the observed version", async () => {
  mount();
  const opener = await screen.findByRole("button", {
    name: "Abrir atención: Revisar entrega del pedido",
  });
  fireEvent.click(opener);
  expect(
    await screen.findByRole("region", { name: "Detalle de atención" }),
  ).toHaveFocus();
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar estado y responsable" }),
  );
  fireEvent.change(screen.getByLabelText("Nuevo estado de la atención"), {
    target: { value: "resolved" },
  });
  expect(
    fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cambios" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/service-cases/case-1" &&
          JSON.parse(String(init?.body)).status === "resolved" &&
          JSON.parse(String(init?.body)).expected_version === 3,
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cerrar detalle" }));
  expect(opener).toHaveFocus();
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        init?.method !== "GET" &&
        (String(url).includes("/orders") || String(url).includes("/messaging")),
    ),
  ).toBe(false);
});
it("appends a private note without replacing prior notes", async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/notes") && init?.method === "POST") {
      record = { ...record, version: 4 };
      events = [
        {
          ...events[0],
          id: "event-2",
          case_version: 4,
          kind: "note_added",
          note: "Se revisó la entrega con el equipo.",
        },
        ...events,
      ];
      return json(record);
    }
    return route(url);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  await screen.findByText("Nota inicial que se conserva");
  fireEvent.change(screen.getByLabelText("Nueva nota del equipo"), {
    target: { value: "Se revisó la entrega con el equipo." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Agregar nota al historial" }),
  );
  expect(
    await screen.findByText("Se revisó la entrega con el equipo."),
  ).toBeVisible();
  expect(screen.getByText("Nota inicial que se conserva")).toBeVisible();
  expect(
    fetchMock.mock.calls.some(([, init]) =>
      ["PUT", "DELETE"].includes(String(init?.method)),
    ),
  ).toBe(false);
});
it("reuses an uncertain note command rather than creating a new operation", async () => {
  let attempts = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/notes") && init?.method === "POST") {
      attempts++;
      if (attempts === 1) throw new TypeError("NetworkError");
      return json(record);
    }
    return route(url);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  fireEvent.change(screen.getByLabelText("Nueva nota del equipo"), {
    target: { value: "Nota con respuesta incierta" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Agregar nota al historial" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Agregar nota al historial" }),
  );
  await screen.findByText(/Nota privada agregada al historial/);
  const posts = fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith("/notes") && init?.method === "POST",
  );
  expect(posts).toHaveLength(2);
  expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
  expect(posts[0][1]?.headers).toMatchObject({
    "Idempotency-Key": (posts[1][1]?.headers as Record<string, string>)[
      "Idempotency-Key"
    ],
  });
});
it("blocks stale edits after a version conflict without discarding the note draft", async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "PATCH") {
      record = { ...record, version: 4 };
      return json({ detail: "La atención cambió" }, 409);
    }
    return route(url);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  fireEvent.change(screen.getByLabelText("Nueva nota del equipo"), {
    target: { value: "Borrador que debe conservarse" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar estado y responsable" }),
  );
  fireEvent.change(screen.getByLabelText("Nuevo estado de la atención"), {
    target: { value: "in_progress" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cambios" }));
  expect(await screen.findByText(/Descarta esta edición/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Confirmar cambios" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Nueva nota del equipo")).toHaveValue(
    "Borrador que debe conservarse",
  );
});
it("uses server overdue state and sends filters to the API", async () => {
  record = { ...record, status: "resolved", overdue: false };
  mount();
  await screen.findByRole("heading", { name: record.title });
  expect(screen.getByText(/^Vencimiento:/)).toBeVisible();
  expect(screen.queryByText(/^Vencida desde/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Sólo atenciones vencidas"));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("overdue_only=true"),
      ),
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText("Estado de atención"), {
    target: { value: "reopened" },
  });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url).includes("status=reopened") &&
          String(url).includes("overdue_only=true"),
      ),
    ).toBe(true),
  );
});
it("offers reopening a resolved case and treats cancellation as terminal", async () => {
  record = { ...record, status: "resolved", overdue: false };
  const view = mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar estado y responsable" }),
  );
  expect(
    within(screen.getByLabelText("Nuevo estado de la atención")).getByRole(
      "option",
      { name: "Reabierta" },
    ),
  ).toBeVisible();
  view.unmount();
  record = { ...record, status: "cancelled" };
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar estado y responsable" }),
  );
  expect(
    within(screen.getByLabelText("Nuevo estado de la atención")).getAllByRole(
      "option",
    ),
  ).toHaveLength(1);
  expect(screen.getByLabelText("Nueva nota del equipo")).toBeVisible();
  await screen.findByText("Nota inicial que se conserva");
});
it("does not fetch private cases for cashiers or offline sessions", () => {
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
it("aborts a previous branch and ignores its late private response", async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async (url, init) =>
    String(url).startsWith("/api/v1/service-cases?") &&
    (init?.headers as Record<string, string>)["X-Kova-Branch"] === "branch-1"
      ? new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
      : String(url).includes("/assignees")
        ? json({ items: [] })
        : json({ items: [], has_more: false }),
  );
  const view = mount();
  await waitFor(() => expect(resolveOld).toBeDefined());
  const previous = fetchMock.mock.calls.find(([url]) =>
    String(url).startsWith("/api/v1/service-cases?"),
  )![1]?.signal;
  session.branch = "branch-2";
  view.rerender(
    <MemoryRouter>
      <ServiceCasesView />
    </MemoryRouter>,
  );
  await screen.findByText(/No hay atenciones con estos filtros/);
  resolveOld!(json({ items: [record], has_more: false }));
  await waitFor(() =>
    expect(screen.queryByText(record.title)).not.toBeInTheDocument(),
  );
  expect(previous?.aborted).toBe(true);
});

it("does not submit a no-op or truncate an unchanged deadline", async () => {
  record = { ...record, due_at: "2020-10-19T10:00:35Z" };
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar estado y responsable" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirmar cambios" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nuevo estado de la atención"), {
    target: { value: "resolved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cambios" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true),
  );
  const update = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "PATCH",
  )!;
  expect(JSON.parse(String(update[1]?.body))).toEqual({
    expected_version: 3,
    status: "resolved",
  });
});
it("keeps the original note command after refreshing an uncertain successful append", async () => {
  let attempts = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/notes") && init?.method === "POST") {
      attempts++;
      if (attempts === 1) {
        record = { ...record, version: 4 };
        events = [
          {
            ...events[0],
            id: "event-2",
            case_version: 4,
            kind: "note_added",
            note: "Nota guardada con respuesta incierta",
          },
          ...events,
        ];
        throw new TypeError("NetworkError");
      }
      return json(record);
    }
    return route(url);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  fireEvent.change(screen.getByLabelText("Nueva nota del equipo"), {
    target: { value: "Nota guardada con respuesta incierta" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Agregar nota al historial" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Actualizar atenciones" }),
  );
  await within(
    screen.getByRole("region", { name: "Historial privado de atención" }),
  ).findByText("Nota guardada con respuesta incierta");
  fireEvent.click(
    screen.getByRole("button", { name: "Agregar nota al historial" }),
  );
  await screen.findByText(/Nota privada agregada al historial/);
  const commands = fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith("/notes") && init?.method === "POST",
  );
  expect(commands).toHaveLength(2);
  expect(commands[0][1]?.body).toBe(commands[1][1]?.body);
  expect(JSON.parse(String(commands[1][1]?.body)).expected_version).toBe(3);
  expect(commands[0][1]?.headers).toMatchObject({
    "Idempotency-Key": (commands[1][1]?.headers as Record<string, string>)[
      "Idempotency-Key"
    ],
  });
});
it("ignores a late reference response for the previously selected customer", async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/references?")
      ? String(url).includes("customer_id=customer-1")
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve;
          })
        : json({
            sales: [
              {
                id: "sale-other",
                total_amount: "80.00",
                occurred_at: "2026-10-19T12:00:00Z",
                status: "completed",
              },
            ],
            customer_orders: [],
            sales_has_more: false,
            customer_orders_has_more: false,
          })
      : route(url),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Nueva atención postventa" }),
  );
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente de la atención"), {
    target: { value: customer.id },
  });
  await waitFor(() => expect(resolveOld).toBeDefined());
  fireEvent.change(screen.getByLabelText("Cliente de la atención"), {
    target: { value: "customer-2" },
  });
  await waitFor(() =>
    expect(
      screen
        .getByLabelText("Venta relacionada")
        .querySelector('option[value="sale-other"]'),
    ).not.toBeNull(),
  );
  resolveOld!(
    json({
      sales: [
        {
          id: "sale-old-private",
          total_amount: "100.00",
          occurred_at: "2026-10-19T12:00:00Z",
        },
      ],
      customer_orders: [],
      sales_has_more: false,
      customer_orders_has_more: false,
    }),
  );
  await waitFor(() =>
    expect(
      screen
        .getByLabelText("Venta relacionada")
        .querySelector('option[value="sale-old-private"]'),
    ).toBeNull(),
  );
  expect(screen.getByLabelText("Cliente de la atención")).toHaveValue(
    "customer-2",
  );
});

it("shows a revoked assignee's status even while their email remains cached", async () => {
  record = { ...record, assignee_active: false };
  mount();
  expect(
    await screen.findByText(
      "owner@example.com · Sin acceso actual a la sucursal",
    ),
  ).toBeVisible();
});
it("identifies event authors without inventing names for members outside the current list", async () => {
  events = [{ ...events[0], actor_user_id: "historical-user-42" }];
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Abrir atención: Revisar entrega del pedido",
    }),
  );
  expect(
    await screen.findByText("Registrado por Usuario historical-user-42."),
  ).toBeVisible();
});
