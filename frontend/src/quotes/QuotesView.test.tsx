import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import QuotesView from "./QuotesView";
import type { Quote } from "./types";

const access = vi.hoisted(() => ({ tenantId: "tenant-1", branchId: "branch-1" }));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: "owner" },
      tenantId: access.tenantId,
      sessionMode: "online",
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => access.branchId,
}));
const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const product = {
  id: "product-1",
  name: "Pan de nuez",
  price_amount: "45.00",
  is_active: true,
  modifier_groups: [],
};
const customer = {
  id: "customer-1",
  name: "Cliente registrado",
  is_active: true,
  phone: null,
  email: null,
  created_at: "2026-10-18T12:00:00Z",
};
const quote: Quote = {
  id: "quote-1",
  folio: "COT-001",
  status: "draft",
  customer_id: customer.id,
  customer_name: customer.name,
  expires_at: "2099-01-01T12:00:00Z",
  total_amount: "90.00",
  version: 1,
  customer_order_id: null,
  created_at: "2026-10-18T12:00:00Z",
  updated_at: "2026-10-18T12:00:00Z",
  items: [
    {
      id: "item-1",
      product_id: product.id,
      product_name: product.name,
      quantity: 2,
      unit_price_amount: "45.00",
      line_total_amount: "90.00",
    },
  ],
};
const mount = () =>
  render(
    <MemoryRouter>
      <QuotesView />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  access.tenantId = "tenant-1";
  access.branchId = "branch-1";
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/customers?")
      ? json([customer])
      : String(url).endsWith("/catalog/products")
        ? json([product])
        : json({ items: [quote], total: 1 }),
  );
});

it("creates a quote from catalog identifiers and quantities, without accepting client prices", async () => {
  mount();
  await screen.findByRole("heading", { name: "COT-001 · Cliente registrado" });
  fireEvent.click(screen.getByRole("button", { name: "Nueva cotización" }));
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: customer.id },
  });
  fireEvent.change(
    screen.getByLabelText("Vigencia (hora de este dispositivo)"),
    { target: { value: "2099-01-01T12:00" } },
  );
  fireEvent.change(screen.getByLabelText("Producto", { exact: true }), {
    target: { value: product.id },
  });
  fireEvent.change(screen.getByLabelText("Cantidad", { exact: true }), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Agregar producto" }));
  fireEvent.click(screen.getByRole("button", { name: "Crear cotización" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/api/v1/quotes" && init?.method === "POST",
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(
    ([url, init]) => url === "/api/v1/quotes" && init?.method === "POST",
  )!;
  const body = JSON.parse(init!.body as string);
  expect(body).toEqual({
    customer_id: customer.id,
    expires_at: new Date("2099-01-01T12:00").toISOString(),
    items: [{ product_id: product.id, quantity: 2 }],
  });
  expect(body.items[0]).not.toHaveProperty("price_amount");
  expect(
    await screen.findByText(
      /No se reservaron existencias ni se registró ingreso/,
    ),
  ).toBeVisible();
});

it("records a human-shared proposal only after explicit attestation", async () => {
  mount();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Registrar propuesta compartida",
    }),
  );
  expect(
    screen.getByRole("button", { name: "Registrar que fue compartida" }),
  ).toBeDisabled();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /Confirmo que el equipo ya compartió/,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar que fue compartida" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/quote-1/mark-sent"),
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/quote-1/mark-sent"),
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    expected_version: 1,
    confirmed_shared: true,
  });
  expect(await screen.findByText(/Kova no envió mensajes/)).toBeVisible();
});

it("converts a proposal only after confirming customer acceptance", async () => {
  let accepted = false;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).includes("/customers?")) return json([customer]);
    if (String(url).endsWith("/catalog/products")) return json([product]);
    if (init?.method === "POST") {
      accepted = true;
      return json({
        ...quote,
        status: "accepted",
        customer_order_id: "order-1",
        version: 3,
      });
    }
    return json({
      items: [
        {
          ...quote,
          status: accepted ? "accepted" : "sent",
          version: accepted ? 3 : 2,
          customer_order_id: accepted ? "order-1" : null,
        },
      ],
      total: 1,
    });
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Registrar aceptación" }),
  );
  expect(
    screen.getByRole("button", { name: "Registrar aceptación y crear pedido" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Confirmo que el cliente aceptó/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar aceptación y crear pedido" }),
  );
  const link = await screen.findByRole("link", {
    name: "Revisar pedido creado",
  });
  expect(link).toHaveAttribute("href", "/pedidos/order-1");
  const [, init] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/quote-1/accept"),
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    expected_version: 2,
    confirmed_customer_acceptance: true,
  });
});

it("preserves the server explanation when catalog changes invalidate acceptance", async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).includes("/customers?")) return json([customer]);
    if (String(url).endsWith("/catalog/products")) return json([product]);
    if (init?.method === "POST")
      return json(
        {
          detail:
            "Los precios o productos cambiaron. Revisa y crea una cotización nueva.",
        },
        409,
      );
    return json({
      items: [{ ...quote, status: "sent", version: 2 }],
      total: 1,
    });
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Registrar aceptación" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Confirmo que el cliente aceptó/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar aceptación y crear pedido" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "crea una cotización nueva",
  );
  expect(
    screen.queryByRole("link", { name: "Revisar pedido creado" }),
  ).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});

it("shows the real commercial journey without treating POS payments as provider collection", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith("/journey")
      ? json({
          quote_id: quote.id,
          catalog_request_id: "request-1",
          opportunity_id: "opportunity-1",
          opportunity_stage: "won",
          customer_order_id: "customer-order-1",
          customer_order_status: "fulfilled",
          sale_order_id: "sale-1",
          sale_status: "completed",
          sale_total_amount: "90.00",
          recorded_payments_amount: "90.00",
          external_collection_verified: false,
        })
      : String(url).includes("/customers?")
        ? json([customer])
        : String(url).endsWith("/catalog/products")
          ? json([product])
          : json({ items: [quote], total: 1 }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Ver recorrido comercial" }),
  );
  expect(
    await screen.findByText(/Solicitud de catálogo vinculada/),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Consultar pedido" }),
  ).toHaveAttribute("href", "/pedidos/customer-order-1");
  expect(screen.getByRole("link", { name: "Consultar venta" })).toHaveAttribute(
    "href",
    "/orders/sale-1",
  );
  expect(
    screen.getByText(/no acreditan un cobro electrónico verificado/),
  ).toBeVisible();
});

it("loads opportunities only for the selected quote customer", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/crm?")
      ? json({
          opportunities: [{ id: "opportunity-1", title: "Pedido de evento" }],
        })
      : String(url).includes("/customers?")
        ? json([customer])
        : String(url).endsWith("/catalog/products")
          ? json([product])
          : json({ items: [quote], total: 1 }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Nueva cotización" }),
  );
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: customer.id },
  });
  await screen.findByRole("option", { name: "Pedido de evento" });
  expect(
    fetchMock.mock.calls.some(
      ([url]) =>
        url === `/api/v1/crm?customer_id=${customer.id}&limit=100&offset=0`,
    ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Oportunidad de origen (opcional)"), {
    target: { value: "opportunity-1" },
  });
  fireEvent.change(screen.getByLabelText("Cliente registrado"), {
    target: { value: "" },
  });
  expect(screen.getByLabelText("Oportunidad de origen (opcional)")).toHaveValue(
    "",
  );
});

const linkedOpportunity = {
  id: "10000000-0000-4000-8000-000000000001",
  customer_id: "20000000-0000-4000-8000-000000000001",
  customer_name: "Cliente de la oportunidad",
  title: "Propuesta fuera de la primera página",
  stage: "proposal",
  version: 2,
};

function LinkLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="quote-location">{location.pathname}{location.search}{location.hash}:{JSON.stringify(location.state)}</output>
    <button onClick={() => navigate("/quotes?filter=manual#manual")}>Salir del enlace</button>
  </>;
}

it("prefills the exact opportunity and its server customer outside paginated search without writing", async () => {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith(`/crm/opportunities/${linkedOpportunity.id}`)) return json(linkedOpportunity);
    if (String(url).includes("/crm?")) return json({ opportunities: [], opportunities_has_more: true });
    if (String(url).includes("/customers?")) return json([]);
    if (String(url).endsWith("/catalog/products")) return json([product]);
    return json({ items: [], total: 0 });
  });
  render(<MemoryRouter initialEntries={[{ pathname: "/quotes", search: `?opportunity_id=${linkedOpportunity.id}&customer_id=untrusted&filter=draft`, hash: "#propuesta", state: { from: "crm" } }]}><LinkLocation /><QuotesView /></MemoryRouter>);
  expect(await screen.findByRole("form", { name: "Nueva cotización" })).toBeVisible();
  await screen.findByRole("option", { name: linkedOpportunity.customer_name });
  expect(screen.getByLabelText("Cliente registrado")).toHaveValue(linkedOpportunity.customer_id);
  expect(screen.getByLabelText("Oportunidad de origen (opcional)")).toHaveValue(linkedOpportunity.id);
  expect(screen.getByRole("option", { name: linkedOpportunity.title })).toBeVisible();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method !== "GET")).toBe(false);
  await waitFor(() => expect(screen.getByTestId("quote-location")).toHaveTextContent('/quotes?customer_id=untrusted&filter=draft#propuesta:{"from":"crm"}'));
  expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/crm/opportunities/${linkedOpportunity.id}`))?.[1]).toMatchObject({
    credentials: "include", cache: "no-store",
    headers: expect.objectContaining({ "X-Kova-Expected-Tenant": "tenant-1", "X-Kova-Branch": "branch-1" }),
  });
});

const sourceFetch = (response: () => Promise<Response>) => {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/crm/opportunities/")) return response();
    if (String(url).includes("/customers?")) return json([customer]);
    if (String(url).includes("/crm?")) return json({ opportunities: [] });
    if (String(url).endsWith("/catalog/products")) return json([product]);
    return json({ items: [], total: 0 });
  });
};

it.each([403, 404, 409, 503])("does not prefill or write from an unavailable opportunity (%s)", async (status) => {
  sourceFetch(async () => json({ detail: "Unavailable" }, status));
  render(<MemoryRouter initialEntries={[`/quotes?opportunity_id=${linkedOpportunity.id}`]}><QuotesView /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent(status === 403 || status === 404 ? "no está disponible" : "No pudimos consultar");
  expect(screen.queryByRole("form", { name: "Nueva cotización" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar precarga" }));
  fireEvent.click(screen.getByRole("button", { name: "Nueva cotización" }));
  expect(screen.getByLabelText("Cliente registrado")).toHaveValue("");
});

it.each(["opportunity_id=invalid", `opportunity_id=${linkedOpportunity.id}&opportunity_id=${linkedOpportunity.id}`])("rejects invalid or duplicated source parameters (%s)", async (query) => {
  render(<MemoryRouter initialEntries={[`/quotes?${query}`]}><QuotesView /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("identificador de registro válido");
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/crm/opportunities/"))).toBe(false);
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
});

it("rejects an exact endpoint response for a different opportunity", async () => {
  sourceFetch(async () => json({ ...linkedOpportunity, id: "10000000-0000-4000-8000-000000000002" }));
  render(<MemoryRouter initialEntries={[`/quotes?opportunity_id=${linkedOpportunity.id}`]}><QuotesView /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar");
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
});

it.each(["cancel", "navigate", "branch", "tenant"])("ignores a late source response after %s", async (change) => {
  let resolveSource!: (response: Response) => void;
  let calls = 0;
  sourceFetch(() => ++calls === 1 ? new Promise(resolve => { resolveSource = resolve; }) : Promise.resolve(json({}, 404)));
  const view = render(<MemoryRouter initialEntries={[`/quotes?opportunity_id=${linkedOpportunity.id}`]}><LinkLocation /><QuotesView /></MemoryRouter>);
  await waitFor(() => expect(calls).toBe(1));
  if (change === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancelar precarga" }));
  else if (change === "navigate") fireEvent.click(screen.getByRole("button", { name: "Salir del enlace" }));
  else {
    if (change === "branch") access.branchId = "branch-2";
    else access.tenantId = "tenant-2";
    view.rerender(<MemoryRouter><LinkLocation /><QuotesView /></MemoryRouter>);
    await screen.findByRole("alert");
  }
  await act(async () => { resolveSource(json(linkedOpportunity)); });
  expect(screen.queryByRole("form", { name: "Nueva cotización" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: linkedOpportunity.customer_name })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});

it("does not prefill a source while offline", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  render(<MemoryRouter initialEntries={[`/quotes?opportunity_id=${linkedOpportunity.id}`]}><QuotesView /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Conéctate para consultar");
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/crm/opportunities/"))).toBe(false);
});

it("clears the verified source on manual customer change without writing", async () => {
  sourceFetch(async () => json(linkedOpportunity));
  render(<MemoryRouter initialEntries={[`/quotes?opportunity_id=${linkedOpportunity.id}&customer_id=untrusted`]}><QuotesView /></MemoryRouter>);
  await screen.findByRole("form", { name: "Nueva cotización" });
  await screen.findByRole("option", { name: customer.name });
  fireEvent.change(screen.getByLabelText("Cliente registrado"), { target: { value: customer.id } });
  expect(screen.getByLabelText("Oportunidad de origen (opcional)")).toHaveValue("");
  expect(screen.queryByRole("option", { name: linkedOpportunity.title })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});
