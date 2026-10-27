import { fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import LoyaltyView from "./LoyaltyView";
const render = (view: ReactElement) => renderView(view, { wrapper: MemoryRouter });
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
const customer = { id: "customer-1", name: "Cliente registrado" };
const account = {
  customer_id: customer.id,
  customer_name: customer.name,
  balance: 50,
};
const ledger = {
  ...account,
  adjustments_pending: false,
  entries: [
    {
      id: "entry-1",
      kind: "accrual",
      points: 50,
      sale_order_id: "sale-1",
      benefit: null,
      created_at: "2026-10-19T12:00:00Z",
    },
  ],
  has_more: false,
};
const overview = {
  policy: {
    enabled: false,
    spend_amount: null,
    points_per_step: null,
    version: 0,
  },
  accounts: [account],
  accounts_has_more: false,
};
const route = async (url: RequestInfo | URL) =>
  String(url).includes("/api/v1/customers?")
    ? json([customer])
    : String(url).includes("/loyalty/customers/")
      ? json(ledger)
      : json(overview);
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
it("starts with no invented monetary rule and requires an explicit opt-in", async () => {
  render(<LoyaltyView />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Revisar regla de puntos" }),
  );
  expect(
    screen.getByLabelText("Compra necesaria por bloque (MXN)"),
  ).toHaveValue(null);
  expect(screen.getByLabelText("Puntos por bloque de compra")).toHaveValue(
    null,
  );
  expect(
    screen.getByLabelText("Acumular puntos en nuevas ventas elegibles"),
  ).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Compra necesaria por bloque (MXN)"), {
    target: { value: "100.00" },
  });
  fireEvent.change(screen.getByLabelText("Puntos por bloque de compra"), {
    target: { value: "5" },
  });
  fireEvent.click(
    screen.getByLabelText("Acumular puntos en nuevas ventas elegibles"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar regla de puntos" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/loyalty/policy" &&
          init?.body ===
            JSON.stringify({
              expected_version: 0,
              enabled: true,
              spend_amount: "100.00",
              points_per_step: 5,
            }),
      ),
    ).toBe(true),
  );
});

it("links to the source sale without presenting its internal identifier as customer-facing copy", async () => {
  render(<LoyaltyView />);
  fireEvent.click(await screen.findByRole("button", { name: /Cliente registrado.*50 puntos/ }));
  expect(await screen.findByRole("link", { name: "Ver venta de origen" })).toHaveAttribute("href", "/orders/sale-1");
  expect(screen.queryByText(/Venta de origen:|sale-1/)).not.toBeInTheDocument();
});

it.each(["malformed JSON", "technical network error"])("keeps a %s out of customer points feedback", async failure => {
  fetchMock.mockImplementation(async url => {
    if (!String(url).includes("/loyalty/customers/")) return route(url);
    if (failure === "malformed JSON") return new Response("<html>proxy error</html>", { status: 200 });
    throw new Error("Failed to fetch: backend postgres connection failed");
  });
  render(<LoyaltyView />);
  fireEvent.click(await screen.findByRole("button", { name: /Cliente registrado.*50 puntos/ }));
  expect(await screen.findByText("No pudimos consultar los puntos del cliente.")).toBeVisible();
  expect(screen.queryByText(/Unexpected token|Failed to fetch|postgres|proxy error/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Ver venta de origen" })).not.toBeInTheDocument();
});
it("records a debit only with benefit and owner attestation using the observed balance", async () => {
  render(<LoyaltyView />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Cliente registrado.*50 puntos/,
    }),
  );
  await screen.findByRole("heading", { name: customer.name });
  fireEvent.click(
    screen.getByRole("button", { name: "Preparar canje de puntos" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirmar canje de puntos" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Puntos a canjear"), {
    target: { value: "20" },
  });
  fireEvent.change(screen.getByLabelText("Beneficio acordado con el cliente"), {
    target: { value: "Producto acordado para revisión manual" },
  });
  fireEvent.click(screen.getByLabelText(/Confirmo el débito de puntos/));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar canje de puntos" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/v1/loyalty/customers/customer-1/redeem" &&
          init?.body ===
            JSON.stringify({
              points: 20,
              expected_balance: 50,
              benefit: "Producto acordado para revisión manual",
              confirmed: true,
            }),
      ),
    ).toBe(true),
  );
  expect(
    await screen.findByText(/Canje registrado en puntos/),
  ).toHaveTextContent("por separado");
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes("/orders")),
  ).toBe(false);
});
it("blocks redemption while refund or void adjustments are pending", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/loyalty/customers/")
      ? json({ ...ledger, adjustments_pending: true })
      : route(url),
  );
  render(<LoyaltyView />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Cliente registrado.*50 puntos/,
    }),
  );
  expect(
    await screen.findByText(/Procesa devoluciones o anulaciones pendientes/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Preparar canje de puntos" }),
  ).toBeDisabled();
});
it("shows a negative balance honestly and disables further debits", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/loyalty/customers/")
      ? json({ ...ledger, balance: -10 })
      : route(url),
  );
  render(<LoyaltyView />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Cliente registrado.*50 puntos/,
    }),
  );
  expect(await screen.findByText("-10 puntos")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Preparar canje de puntos" }),
  ).toBeDisabled();
});
it("keeps managers, cashiers and offline sessions out of private loyalty requests", () => {
  for (const role of ["manager", "cashier"]) {
    session.role = role;
    const view = render(<LoyaltyView />);
    expect(screen.getByText("Lealtad administrada por el dueño")).toBeVisible();
    view.unmount();
  }
  session.role = "owner";
  session.mode = "offline";
  render(<LoyaltyView />);
  expect(screen.getByText(/Conéctate para consultar/)).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("discards another branch's account snapshot", async () => {
  const view = render(<LoyaltyView />);
  await screen.findByRole("button", { name: /Cliente registrado.*50 puntos/ });
  const previousSignal = fetchMock.mock.calls[0][1]?.signal;
  session.branch = "branch-2";
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([])
      : json({ ...overview, accounts: [] }),
  );
  view.rerender(<LoyaltyView />);
  expect(
    await screen.findByText(/No hay movimientos de puntos en esta página/),
  ).toBeVisible();
  expect(previousSignal?.aborted).toBe(true);
  expect(
    screen.queryByRole("button", { name: /Cliente registrado.*50 puntos/ }),
  ).not.toBeInTheDocument();
});

it("clears old search choices immediately and offers an explicit retry without losing the selected ledger", async () => {
  let failLuis = true;
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/api/v1/customers?")) {
      if (String(url).includes("q=Luis")) return failLuis ? json({ detail: "Unavailable" }, 503) : json([{ id: "luis", name: "Luis" }]);
      return json([{ id: "ana", name: "Ana" }]);
    }
    return route(url);
  });
  render(<LoyaltyView />);
  await screen.findByRole("option", { name: "Ana" });
  fireEvent.click(screen.getByRole("button", { name: /Cliente registrado.*50 puntos/ }));
  await screen.findByRole("heading", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Buscar cliente para consultar puntos"), { target: { value: "Luis" } });
  expect(screen.queryByRole("option", { name: "Ana" })).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Cliente del programa" })).toBeDisabled();
  await screen.findByText(/No pudimos buscar clientes/);
  expect(screen.getByRole("heading", { name: customer.name })).toBeVisible();
  expect(screen.queryByRole("option", { name: "Ana" })).not.toBeInTheDocument();
  failLuis = false;
  fireEvent.click(screen.getByRole("button", { name: "Volver a buscar clientes" }));
  await screen.findByRole("option", { name: "Luis" });
  expect(screen.getByRole("combobox", { name: "Cliente del programa" })).toHaveValue(customer.id);
  expect(screen.getByRole("option", { name: customer.name })).toBeDisabled();
});

it("discards an earlier customer search response after the current search fails", async () => {
  let resolveAna: (response: Response) => void = () => {};
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/api/v1/customers?")) {
      if (String(url).includes("q=Luis")) return json({ detail: "Unavailable" }, 503);
      return new Promise<Response>(resolve => { resolveAna = resolve; });
    }
    return route(url);
  });
  render(<LoyaltyView />);
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/customers?q="))).toBe(true));
  fireEvent.change(screen.getByLabelText("Buscar cliente para consultar puntos"), { target: { value: "Luis" } });
  await screen.findByText(/No pudimos buscar clientes/);
  resolveAna(json([{ id: "ana", name: "Ana" }]));
  await waitFor(() => expect(screen.queryByRole("option", { name: "Ana" })).not.toBeInTheDocument());
  expect(screen.getByRole("combobox", { name: "Cliente del programa" })).toBeDisabled();
});

it("labels returned reward points without hiding their positive amount", async () => {
  fetchMock.mockImplementation(async url => String(url).includes("/loyalty/customers/")
    ? json({ ...ledger, entries: [{ ...ledger.entries[0], kind: "reward_return", points: 8 }] })
    : route(url));
  render(<LoyaltyView />);
  fireEvent.click(await screen.findByRole("button", { name: /Cliente registrado.*50 puntos/ }));
  expect(await screen.findByText("Puntos restituidos")).toBeVisible();
  expect(screen.getByText("+8 puntos")).toBeVisible();
});
