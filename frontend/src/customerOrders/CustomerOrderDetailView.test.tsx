import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { CustomerOrder } from "./types";

const api = vi.hoisted(() => ({
  route: { orderId: "a" }, online: true,
  get: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), changeStatus: vi.fn(),
  readCache: vi.fn(), saveCache: vi.fn(),
}));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: {
  status: "authenticated", tenantId: "tenant", user: { id: "owner", role: "owner" },
} }) }));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/branches/activeBranch", () => ({ getActiveBranchId: () => "branch" }));
vi.mock("@/offline/useSyncQueue", () => ({ useIsOnline: () => api.online }));
vi.mock("react-router-dom", async original => ({ ...await original<object>(), useParams: () => api.route }));
vi.mock("./api", () => ({
  getCustomerOrder: (...args: unknown[]) => api.get(...args),
  confirmCustomerOrder: (...args: unknown[]) => api.confirm(...args),
  cancelCustomerOrder: (...args: unknown[]) => api.cancel(...args),
  changeCustomerOrderStatus: (...args: unknown[]) => api.changeStatus(...args),
}));
vi.mock("./cache", () => ({
  readCustomerOrderCache: (...args: unknown[]) => api.readCache(...args),
  saveCustomerOrderDetail: (...args: unknown[]) => api.saveCache(...args),
}));
import CustomerOrderDetailView from "./CustomerOrderDetailView";

const order = (id: string): CustomerOrder => ({
  id, tenant_id: "tenant", folio: `PED-${id.toUpperCase()}`, status: "new", payment_status: "unpaid",
  fulfillment_type: "pickup", source_channel: "counter", customer_name: null, customer_phone: null,
  delivery_address: null, delivery_reference: null, promised_at: null, note: null,
  subtotal_amount: "25.00", total_amount: "25.00", sale_order_id: null, version: 1, stock_conflict: false,
  items: [], confirmed_at: null, ready_at: null, fulfilled_at: null, cancelled_at: null,
  cancellation_reason: null, cancellation_note: null, created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
const renderView = () => render(<MemoryRouter><CustomerOrderDetailView /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.route.orderId = "a";
  api.online = true;
  api.get.mockReset().mockResolvedValue(order("a"));
  api.confirm.mockReset().mockResolvedValue({ ...order("a"), status: "confirmed", version: 2 });
  api.readCache.mockReset().mockResolvedValue(undefined);
  api.saveCache.mockReset().mockResolvedValue(undefined);
});

it("discards an old detail response and cache write after navigating to another order", async () => {
  const a = deferred<CustomerOrder>();
  const b = deferred<CustomerOrder>();
  api.get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const view = renderView();
  api.route.orderId = "b";
  view.rerender(<MemoryRouter><CustomerOrderDetailView /></MemoryRouter>);
  await act(async () => b.resolve(order("b")));
  expect(screen.getAllByRole("heading", { name: "PED-B" })[0]).toBeInTheDocument();
  await act(async () => a.resolve(order("a")));
  expect(screen.queryByRole("heading", { name: "PED-A" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/pedidos/b/editar");
  expect(api.saveCache).toHaveBeenCalledTimes(1);
  expect(api.saveCache).toHaveBeenCalledWith("tenant", order("b"), "branch");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar y reservar" }));
  await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("b", 1));
});

it("does not apply a prior order's pending mutation after the route changes", async () => {
  const confirmation = deferred<CustomerOrder>();
  api.confirm.mockReturnValueOnce(confirmation.promise);
  const view = renderView();
  await screen.findByRole("button", { name: "Confirmar y reservar" });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar y reservar" }));
  api.route.orderId = "b";
  api.get.mockResolvedValue(order("b"));
  view.rerender(<MemoryRouter><CustomerOrderDetailView /></MemoryRouter>);
  await screen.findByRole("link", { name: "Editar" });
  await act(async () => confirmation.resolve({ ...order("a"), status: "confirmed", version: 2 }));
  expect(screen.queryByRole("heading", { name: "PED-A" })).not.toBeInTheDocument();
  expect(api.saveCache).toHaveBeenCalledTimes(2);
  expect(api.saveCache).toHaveBeenLastCalledWith("tenant", order("b"), "branch");
});

it("keeps a legacy cached detail read-only even online and does not invent its freshness", async () => {
  api.get.mockRejectedValue(new TypeError("Failed to fetch"));
  api.readCache.mockResolvedValue({ details: { a: order("a") }, cached_at: "2026-11-17T12:00:00Z" });
  renderView();
  expect(await screen.findByRole("status")).toHaveTextContent("no conocemos la fecha de actualización");
  expect(screen.queryByRole("button", { name: "Confirmar y reservar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
});

it("uses only the specific cached detail timestamp when consulting offline", async () => {
  api.online = false;
  api.readCache.mockResolvedValue({
    details: { a: order("a") }, cached_at: "2026-11-17T12:00:00Z",
    detail_cached_at: { a: "2026-11-01T12:00:00Z" },
  });
  renderView();
  expect(await screen.findByRole("status")).toHaveTextContent(/01\/11\/2026/);
  expect(screen.getByRole("status")).not.toHaveTextContent(/17\/11\/2026/);
  expect(api.get).not.toHaveBeenCalled();
});
