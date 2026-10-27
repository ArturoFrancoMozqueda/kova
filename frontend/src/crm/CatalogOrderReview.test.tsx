import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CatalogOrderReview, type CatalogOrderPreview } from "./CatalogOrderReview";

const identity = { tenantId: "tenant-a", userId: "owner-a", branchId: "branch-a" };
const row = { id: "request-a", name: "Visitante", contact: "contact@example.com", origin: "in_store" as const };
const customer = { id: "customer-a", name: "Cliente verificado", is_active: true, phone: null, email: null, created_at: "2026-10-26T12:00:00Z", updated_at: "2026-10-26T12:00:00Z" };
const preview: CatalogOrderPreview = { request_id: row.id, version: 4, items: [{ product_id: "product-a", product_name: "Café de olla", quantity: 2, unit_price_amount: "50.00", line_total_amount: "100.00", available_quantity: 5 }], total_amount: "100.00", can_accept: true, issues: [], preview_fingerprint: "reviewed-current-prices", customer_order_id: null };
const fetchMock = vi.fn<typeof fetch>();
const onAccepted = vi.fn();
const onSearch = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mount() { return render(<MemoryRouter><CatalogOrderReview identity={identity} row={row} customers={[customer]} search="" onSearch={onSearch} customerError="" onAccepted={onAccepted} onClose={vi.fn()} /></MemoryRouter>); }
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
async function chooseAndConfirm() {
  await screen.findByText("2 × Café de olla");
  fireEvent.change(screen.getByLabelText("Vincular con cliente registrado"), { target: { value: customer.id } });
  fireEvent.click(screen.getByLabelText(/Revisé productos, cantidades, precios y cliente/));
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? json({ request: { id: row.id }, customer_order: { id: "order-a", folio: "PED-001" } }, 201)
    : json(preview));
});
afterEach(() => vi.unstubAllGlobals());

it("reviews current prices and requires customer plus explicit attestation before creating the exact linked order", async () => {
  mount();
  expect(await screen.findByText("2 × Café de olla")).toBeVisible();
  const button = screen.getByRole("button", { name: "Crear pedido para confirmar" });
  expect(button).toBeDisabled();
  expect(writes()).toHaveLength(0);
  await chooseAndConfirm();
  fireEvent.click(button);
  expect(await screen.findByRole("link", { name: "Abrir pedido" })).toHaveAttribute("href", "/pedidos/order-a");
  expect(writes()).toHaveLength(1);
  const [url, init] = writes()[0];
  expect(url).toBe("/api/v1/crm/requests/request-a/accept-order");
  expect(JSON.parse(String(init?.body))).toEqual({ customer_id: customer.id, expected_version: 4, preview_fingerprint: preview.preview_fingerprint, confirmed: true });
  expect(init).toEqual(expect.objectContaining({ credentials: "include", headers: expect.objectContaining({ "X-Kova-Branch": "branch-a", "Idempotency-Key": expect.any(String) }) }));
  expect(screen.getByRole("status")).toHaveTextContent("Todavía no reserva inventario ni registra un cobro");
  expect(onAccepted).toHaveBeenCalledOnce();
});

it("blocks acceptance when the reviewed products are unavailable", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...preview, can_accept: false, issues: ["El producto dejó de estar disponible."] }));
  mount();
  expect(await screen.findByText("El producto dejó de estar disponible.")).toBeVisible();
  expect(screen.getByLabelText(/Revisé productos/)).toBeDisabled();
  expect(screen.getByRole("button", { name: "Crear pedido para confirmar" })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

it("refreshes stale prices and requires another review without silently retrying the mutation", async () => {
  let mutations = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") { mutations += 1; return json({ detail: "Precio cambió" }, 409); }
    return json(mutations ? { ...preview, version: 5, total_amount: "120.00", preview_fingerprint: "new-prices", items: [{ ...preview.items[0], unit_price_amount: "60.00", line_total_amount: "120.00" }] } : preview);
  });
  mount(); await chooseAndConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Crear pedido para confirmar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Los datos cambiaron");
  expect(screen.getByLabelText(/Revisé productos/)).not.toBeChecked();
  expect(screen.getByText("$120.00 MXN")).toBeVisible();
  expect(screen.getByRole("button", { name: "Crear pedido para confirmar" })).toBeDisabled();
  expect(writes()).toHaveLength(1);
});

it("reuses the operation key after an uncertain failure and prevents concurrent submissions", async () => {
  let reject: ((value: Response) => void) | undefined;
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise(resolve => { reject = resolve; }) : json(preview));
  mount(); await chooseAndConfirm();
  const button = screen.getByRole("button", { name: "Crear pedido para confirmar" });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(writes()).toHaveLength(1));
  await act(async () => reject!(json({}, 503)));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByLabelText(/Revisé productos/));
  fireEvent.click(screen.getByRole("button", { name: "Crear pedido para confirmar" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[0][1]?.body).toBe(writes()[1][1]?.body);
  expect((writes()[0][1]?.headers as Record<string, string>)["Idempotency-Key"]).toBe((writes()[1][1]?.headers as Record<string, string>)["Idempotency-Key"]);
});

it("offers an existing order instead of creating another from an already accepted request", async () => {
  fetchMock.mockResolvedValueOnce(json({ ...preview, customer_order_id: "existing-order", can_accept: false }));
  mount();
  expect(await screen.findByRole("link", { name: "Abrir pedido existente" })).toHaveAttribute("href", "/pedidos/existing-order");
  expect(screen.queryByRole("button", { name: "Crear pedido para confirmar" })).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("clears the chosen customer when its search changes and blocks offline acceptance", async () => {
  mount(); await chooseAndConfirm();
  fireEvent.change(screen.getByLabelText("Buscar cliente"), { target: { value: "Otra persona" } });
  expect(onSearch).toHaveBeenCalledWith("Otra persona");
  expect(screen.getByLabelText("Vincular con cliente registrado")).toHaveValue("");
  expect(screen.getByLabelText(/Revisé productos/)).not.toBeChecked();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent(window, new Event("offline"));
  expect(screen.getByRole("button", { name: "Crear pedido para confirmar" })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});
