import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import ReplenishmentView from "./ReplenishmentView";

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
const suggestion = {
  product_id: "product-1",
  product_name: "Harina",
  available_quantity: 2,
  reserved_quantity: 1,
  incoming_quantity: 0,
  low_stock_threshold: 5,
  suggested_quantity: 4,
  unit_cost: "12.50",
  evidence_version: "first-evidence",
};
const supplier = { id: "supplier-1", name: "Proveedor registrado" };
const mount = () =>
  render(
    <MemoryRouter>
      <ReplenishmentView />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url, init) =>
    init?.method === "POST" ? json({ id: "purchase-created-1", status: "pending" }) : String(url).endsWith("/purchasing/suppliers")
      ? json([supplier])
      : json([suggestion]),
  );
});

it("requires a supplier and two-step review before creating a pending purchase", async () => {
  mount();
  await screen.findByText("Harina");
  expect(screen.getByRole("button", { name: "Revisar compra" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Proveedor"), {
    target: { value: supplier.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar compra" }));
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  expect(
    screen.getByRole("region", { name: "Confirmación de compra" }),
  ).toHaveTextContent("$50.00");
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar y crear compra pendiente" }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/approve-purchase"),
      ),
    ).toBe(true),
  );
  const [, init] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/approve-purchase"),
  )!;
  expect(JSON.parse(init!.body as string)).toEqual({
    supplier_id: supplier.id,
    items: [
      {
        product_id: suggestion.product_id,
        quantity: 4,
        unit_cost: "12.50",
        evidence_version: "first-evidence",
      },
    ],
  });
  expect(await screen.findByText(/Compra pendiente creada/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Revisar compra creada" })).toHaveAttribute("href", "/purchasing?purchase_id=purchase-created-1");
});

it("blocks a stale purchase and requires reviewing current evidence again", async () => {
  let reads = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") return json({ detail: "stale evidence" }, 409);
    if (String(url).endsWith("/purchasing/suppliers")) return json([supplier]);
    reads++;
    return json([
      {
        ...suggestion,
        ...(reads > 1
          ? {
              available_quantity: 0,
              suggested_quantity: 6,
              evidence_version: "updated-evidence",
            }
          : {}),
      },
    ]);
  });
  mount();
  await screen.findByText("Harina");
  fireEvent.change(screen.getByLabelText("Proveedor"), {
    target: { value: supplier.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar compra" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmar y crear compra pendiente" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Los datos cambiaron",
  );
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Revisar datos actuales" }),
  );
  expect(
    await screen.findByText("Mínimo: 5. Sugerencia: 6 unidades."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: "Confirmar y crear compra pendiente",
    }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revisar compra" })).toBeVisible();
});

it("leaves products without a known cost unselected until the user provides one", async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith("/purchasing/suppliers")
      ? json([supplier])
      : json([{ ...suggestion, unit_cost: null }]),
  );
  mount();
  await screen.findByText("Harina");
  expect(screen.getByRole("checkbox", { name: "Harina" })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Proveedor"), {
    target: { value: supplier.id },
  });
  expect(screen.getByRole("button", { name: "Revisar compra" })).toBeDisabled();
  expect(screen.getByText(/No hay costo registrado/)).toBeVisible();
});
