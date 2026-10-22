import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationsSession } from "@/automations/workspace";
import { useLinkedRecord } from "./useLinkedRecord";
import { LinkedRecordNotice } from "./LinkedRecordNotice";
import ServiceCasesView from "@/serviceCases/ServiceCasesView";
import CrmView from "@/crm/CrmView";
import FollowupsView from "@/crm/FollowupsView";
import AppointmentsView from "@/appointments/AppointmentsView";
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
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function Harness() {
  return (
    <OperationsSession>
      {(identity) => <Reader identity={identity} />}
    </OperationsSession>
  );
}
function Reader({
  identity,
}: {
  identity: { tenantId: string; userId: string; branchId: string };
}) {
  const linked = useLinkedRecord<{ id: string; title: string }>(
    identity,
    "case_id",
    "/api/v1/service-cases",
  );
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <LinkedRecordNotice linked={linked}>
        {linked.record?.title}
      </LinkedRecordNotice>
      <button onClick={() => navigate(`?case_id=${other}`)}>
        Otra entidad
      </button>
      <output>{location.search}</output>
    </>
  );
}
const mount = (
  view: React.ReactNode = <Harness />,
  search = `?case_id=${id}`,
) =>
  render(
    <MemoryRouter initialEntries={[`/source${search}`]}>{view}</MemoryRouter>,
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
  fetchMock.mockImplementation(async (url) =>
    json({
      id: String(url).endsWith(other) ? other : id,
      title: "Entidad exacta",
    }),
  );
});
it.each(["owner", "manager"])(
  "resolves an exact ID through scoped GET for %s and closes only its parameter",
  async (role) => {
    session.role = role;
    mount(undefined, `?case_id=${id}&keep=1`);
    expect(await screen.findByText("Entidad exacta")).toBeVisible();
    expect(fetchMock.mock.calls[0]).toMatchObject([
      `/api/v1/service-cases/${id}`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          "X-Kova-Expected-Tenant": "tenant-1",
          "X-Kova-Expected-User": "user-1",
          "X-Kova-Branch": "branch-1",
        },
      },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Cerrar registro del enlace" }),
    );
    expect(screen.queryByText("Entidad exacta")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("?keep=1");
  },
);
it.each([
  "?case_id=../private",
  "?case_id=",
  "?case_id=https://outside.invalid",
  "?case_id=" + id + "&case_id=" + other,
])(
  "rejects malformed or ambiguous link %s without any read",
  async (search) => {
    mount(undefined, search);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "identificador de registro válido",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it.each([403, 404])(
  "uses a safe unavailable state for HTTP%s and allows retry",
  async (status) => {
    fetchMock.mockResolvedValueOnce(
      json({ detail: "Tenant ajeno secreto" }, status),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no está disponible en tu sucursal",
    );
    expect(screen.queryByText("Tenant ajeno secreto")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Consultar registro de nuevo" }),
    );
    expect(await screen.findByText("Entidad exacta")).toBeVisible();
  },
);
it("does not render a response with another ID", async () => {
  fetchMock.mockResolvedValue(
    json({ id: other, title: "Registro incorrecto" }),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "confirmar el registro",
  );
  expect(screen.queryByText("Registro incorrecto")).not.toBeInTheDocument();
});
it("ignores the previous entity response after query navigation", async () => {
  let resolve: ((r: Response) => void) | undefined;
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith(id)
      ? new Promise((r) => {
          resolve = r;
        })
      : json({ id: other, title: "Segundo registro" }),
  );
  mount();
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Otra entidad" }));
  expect(await screen.findByText("Segundo registro")).toBeVisible();
  await act(async () => resolve?.(json({ id, title: "Respuesta atrasada" })));
  expect(screen.queryByText("Respuesta atrasada")).not.toBeInTheDocument();
});
it("aborts the old branch and hides late private data", async () => {
  let resolve: ((r: Response) => void) | undefined;
  fetchMock.mockImplementation(async (_url, init) =>
    (init?.headers as Record<string, string>)["X-Kova-Branch"] === "branch-1"
      ? new Promise((r) => {
          resolve = r;
        })
      : json({ id, title: "Sucursal nueva" }),
  );
  const view = mount();
  await waitFor(() => expect(resolve).toBeDefined());
  const signal = fetchMock.mock.calls[0][1]?.signal;
  session.branch = "branch-2";
  view.rerender(
    <MemoryRouter initialEntries={[`?case_id=${id}`]}>
      <Harness />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Sucursal nueva")).toBeVisible();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve?.(json({ id, title: "Sucursal anterior" })));
  expect(screen.queryByText("Sucursal anterior")).not.toBeInTheDocument();
});
it("hides offline snapshots and reloads on reconnect", async () => {
  mount();
  await screen.findByText("Entidad exacta");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.queryByText("Entidad exacta")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Conéctate");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  act(() => window.dispatchEvent(new Event("online")));
  expect(await screen.findByText("Entidad exacta")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each(["cashier", "offline"])(
  "does not read linked private data for %s",
  (mode) => {
    if (mode === "cashier") session.role = "cashier";
    else session.mode = "offline";
    mount();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

const exact = {
  id,
  customer_id: "customer-1",
  customer_name: "Cliente del registro",
  title: "Fuera de la primera página",
  version: 3,
  due_at: null,
  created_at: "2026-10-19T12:00:00Z",
  updated_at: "2026-10-19T12:00:00Z",
};
it.each([
  ["case_id", "/api/v1/service-cases", "case"],
  ["opportunity_id", "/api/v1/crm/opportunities", "opportunity"],
  ["task_id", "/api/v1/crm/followups", "task"],
  ["reminder_id", "/api/v1/appointments/reminders", "reminder"],
])(
  "opens %s outside paginated samples with no navigation writes",
  async (parameter, endpoint, kind) => {
    const record =
      kind === "case"
        ? {
            ...exact,
            status: "open",
            assigned_user_id: null,
            assignee_active: false,
            overdue: false,
            sale_order_id: null,
            customer_order_id: null,
            resolved_at: null,
          }
        : kind === "opportunity"
          ? {
              ...exact,
              stage: "proposal",
              estimated_amount: "100.00",
              next_action: "Revisar propuesta",
              note: null,
            }
          : kind === "task"
            ? {
                ...exact,
                status: "completed",
                kind: "incident",
                sale_order_id: null,
                note: "Ya concluida",
                due_at: "2026-10-19T12:00:00Z",
              }
            : {
                ...exact,
                status: "pending",
                appointment_id: other,
                appointment_version: 2,
                starts_at: "2026-10-19T18:00:00Z",
                timezone: "America/Cancun",
                due_at: "2026-10-19T12:00:00Z",
              };
    fetchMock.mockImplementation(async (url) => {
      const path = String(url);
      if (path === `${endpoint}/${id}`) return json(record);
      if (path.includes("/customers?")) return json([]);
      if (path.includes("/crm?"))
        return json({
          opportunities: [],
          consents: [],
          opportunities_has_more: true,
          consents_has_more: false,
          capabilities: { whatsapp: "not_connected", email: "not_connected" },
        });
      if (path.includes("/crm/followups?"))
        return json({
          tasks: [],
          has_more: true,
          policy: {
            enabled: false,
            version: 0,
            review_delay_days: 3,
            rebuy_delay_days: 30,
          },
        });
      return json({ items: [], has_more: true });
    });
    mount(
      kind === "case" ? (
        <ServiceCasesView />
      ) : kind === "opportunity" ? (
        <CrmView />
      ) : kind === "task" ? (
        <FollowupsView />
      ) : (
        <AppointmentsView />
      ),
      `?${parameter}=${id}`,
    );
    if (kind === "case")
      expect(
        await screen.findByRole("region", { name: "Detalle de atención" }),
      ).toHaveTextContent(exact.title);
    else
      expect(
        await within(
          await screen.findByRole("region", { name: "Registro del enlace" }),
        ).findByRole("heading", { name: exact.title }),
      ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([url]) => url === `${endpoint}/${id}`),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method === "GET"),
    ).toBe(true);
    if (kind === "task")
      expect(
        within(
          screen.getByRole("region", { name: "Registro del enlace" }),
        ).queryByRole("button", { name: /Revisar Fuera/ }),
      ).not.toBeInTheDocument();
    if (kind === "opportunity") {
      fireEvent.click(
        within(
          screen.getByRole("region", { name: "Registro del enlace" }),
        ).getByRole("button", { name: /Editar seguimiento/ }),
      );
      expect(
        screen.getByRole("form", { name: "Editar oportunidad" }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Cerrar formulario" })).toBeEnabled();
      fireEvent.click(
        screen.getByRole("button", { name: "Cerrar registro del enlace" }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("form", { name: "Editar oportunidad" }),
        ).not.toBeInTheDocument(),
      );
    }
  },
);

it("normalizes an uppercase UUID before comparing its exact API response", async () => {
  const uppercase = "ABCDEFAB-1234-4234-8234-123456789ABC";
  const lowercase = uppercase.toLowerCase();
  fetchMock.mockImplementation(async () =>
    json({ id: lowercase, title: "UUID normalizado" }),
  );
  mount(undefined, `?case_id=${uppercase}`);
  expect(await screen.findByText("UUID normalizado")).toBeVisible();
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/service-cases/${lowercase}`);
});
