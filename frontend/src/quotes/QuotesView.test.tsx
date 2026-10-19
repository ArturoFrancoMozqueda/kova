import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import QuotesView from "./QuotesView";
import type { Quote } from "./types";

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1", role: "owner" },
      tenantId: "tenant-1",
      sessionMode: "online",
    },
  }),
}));
vi.mock("@/branches/activeBranch", () => ({
  getActiveBranchId: () => "branch-1",
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
