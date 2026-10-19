import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import CommercialRequestsView from "./CommercialRequestsView";
import FollowupsView from "./FollowupsView";
import InboxView from "@/messaging/InboxView";

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
const request = {
  id: "request-1",
  name: "Visitante",
  contact: "contacto@example.com",
  message: "Quiero un pedido",
  product_ids: [],
  status: "new",
  customer_id: null,
  opportunity_id: null,
  version: 2,
  created_at: "2026-10-18T12:00:00Z",
};
const policy = {
  enabled: false,
  review_delay_days: 3,
  rebuy_delay_days: 30,
  version: 0,
};
const conversation = {
  id: "conv-1",
  customer_id: "customer-1",
  customer_name: customer.name,
  subject: "Pedido de aniversario",
  origin: "manual",
  status: "open",
  automation_paused: true,
  assigned_user_id: null,
  version: 1,
};
const mount = (view: React.ReactNode) =>
  render(<MemoryRouter>{view}</MemoryRouter>);
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
});

it("requires a chosen registered customer to convert a public request", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : json({ requests: [request], has_more: false }),
  );
  mount(<CommercialRequestsView />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Revisar solicitud de Visitante",
    }),
  );
  expect(
    screen.getByRole("button", { name: "Crear oportunidad con este cliente" }),
  ).toBeDisabled();
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Vincular con cliente registrado"), {
    target: { value: customer.id },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Crear oportunidad con este cliente" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/crm/requests/request-1/resolve" &&
          init?.body ===
            JSON.stringify({
              expected_version: 2,
              status: "converted",
              customer_id: customer.id,
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

it("activates followup only after reviewing and confirming its policy", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : json({ policy, tasks: [], has_more: false }),
  );
  mount(<FollowupsView />);
  fireEvent.click(await screen.findByRole("button", { name: "Revisar regla" }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
    false,
  );
  fireEvent.click(
    screen.getByLabelText("Crear pendientes a partir de ventas reales"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar regla" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/crm/followups/policy" &&
          init?.body ===
            JSON.stringify({
              expected_version: 0,
              enabled: true,
              review_delay_days: 3,
              rebuy_delay_days: 30,
            }),
      ),
    ).toBe(true),
  );
  expect(screen.getByText(/Registrar una incidencia no bloquea/)).toBeVisible();
});

it("keeps drafts private and prevents send preparation for a disconnected channel", async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).includes("/customers?")) return json([customer]);
    if (String(url).includes("/messages"))
      return json({
        items: [
          {
            id: "msg-1",
            conversation_id: "conv-1",
            direction: "outbound",
            body: "Respuesta privada",
            message_type: "text",
            state: "draft",
            purpose: "transactional",
            version: 1,
            error_code: null,
            created_at: "2026-10-18T12:00:00Z",
            updated_at: "2026-10-18T12:00:00Z",
          },
        ],
        has_more: false,
      });
    if (init?.method === "PATCH") return json(conversation);
    return json({
      items: [conversation],
      has_more: false,
      channel_status: "not_connected",
    });
  });
  mount(<InboxView />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Pedido de aniversario/ }),
  );
  expect(await screen.findByText(/Equipo · Borrador privado/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Preparar envío" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Respuesta del equipo"), {
    target: { value: "Confirmaremos tu pedido" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar borrador privado" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/messaging/conversations/conv-1/messages" &&
          init?.method === "POST",
      ),
    ).toBe(true),
  );
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes("/transition")),
  ).toBe(false);
});

it("uses expected version when releasing human handoff", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : String(url).includes("/messages")
        ? json({ items: [], has_more: false })
        : json({
            items: [conversation],
            has_more: false,
            channel_status: "not_connected",
          }),
  );
  mount(<InboxView />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Pedido de aniversario/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Permitir automatización" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/messaging/conversations/conv-1" &&
          init?.body ===
            JSON.stringify({ expected_version: 1, automation_paused: false }),
      ),
    ).toBe(true),
  );
});

it("does not request private engagement data for cashiers or offline sessions", () => {
  session.role = "cashier";
  const first = mount(<InboxView />);
  expect(screen.getByText("Acceso de administración")).toBeVisible();
  first.unmount();
  session.role = "owner";
  session.mode = "offline";
  mount(<FollowupsView />);
  expect(screen.getByText(/Conéctate para consultar/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("aborts the old branch request and hides old conversation on identity change", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([])
      : json({
          items: [conversation],
          has_more: false,
          channel_status: "not_connected",
        }),
  );
  const view = mount(<InboxView />);
  await screen.findByRole("button", { name: /Pedido de aniversario/ });
  const oldSignal = fetchMock.mock.calls[0][1]?.signal;
  session.branch = "branch-2";
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([])
      : json({ items: [], has_more: false, channel_status: "not_connected" }),
  );
  view.rerender(
    <MemoryRouter>
      <InboxView />
    </MemoryRouter>,
  );
  await screen.findByText(/Todavía no hay conversaciones/);
  expect(oldSignal?.aborted).toBe(true);
  expect(screen.queryByText("Pedido de aniversario")).not.toBeInTheDocument();
});

it("prepares an order notice from a versioned task without requesting external delivery", async () => {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/customers?")) return json([customer]);
    if (String(url) === "/api/v1/automations")
      return json({
        rules: [],
        runs: [
          {
            id: "run-1",
            template_key: "order_ready",
            title: "Pedido listo",
            status: "pending",
            entity_id: "order-1",
            entity_type: "customer_order",
            entity_version: 3,
            version: 2,
          },
        ],
        capabilities: {
          internal_tasks: true,
          external_messaging: false,
          financial_actions: false,
        },
      });
    if (String(url).includes("/messages"))
      return json({ items: [], has_more: false });
    return json({
      items: [conversation],
      has_more: false,
      channel_status: "not_connected",
    });
  });
  mount(<InboxView />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Pedido de aniversario/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Preparar aviso desde un pedido" }),
  );
  await screen.findByRole("option", { name: "Pedido listo" });
  fireEvent.change(screen.getByLabelText("Tarea de pedido"), {
    target: { value: "run-1" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Crear borrador del aviso" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/messaging/drafts/from-automation" &&
          init?.body ===
            JSON.stringify({
              automation_run_id: "run-1",
              expected_run_version: 2,
              conversation_id: "conv-1",
            }),
      ),
    ).toBe(true),
  );
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes("/transition")),
  ).toBe(false);
});
