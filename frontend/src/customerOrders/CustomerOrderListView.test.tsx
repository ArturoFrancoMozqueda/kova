import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrderListItem, CustomerOrderListResponse } from "./types";

const mocks = vi.hoisted(() => ({
  online: true,
  list: vi.fn(),
  readCache: vi.fn(),
  saveCache: vi.fn(),
}));

vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "authenticated", tenantId: "tenant", user: { id: "owner" } } }),
}));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/branches/activeBranch", () => ({ getActiveBranchId: () => "branch" }));
vi.mock("@/offline/useSyncQueue", () => ({ useIsOnline: () => mocks.online }));
vi.mock("./api", () => ({ listCustomerOrders: (...args: unknown[]) => mocks.list(...args) }));
vi.mock("./cache", () => ({
  readCustomerOrderCache: (...args: unknown[]) => mocks.readCache(...args),
  saveCustomerOrderList: (...args: unknown[]) => mocks.saveCache(...args),
}));

import CustomerOrderListView from "./CustomerOrderListView";

function order(folio: string, promisedAt: string | null = null): CustomerOrderListItem {
  return {
    id: folio, folio, status: "new", payment_status: "unpaid", fulfillment_type: "pickup",
    customer_name: "Cliente", customer_phone: null, promised_at: promisedAt,
    total_amount: "50.00", stock_conflict: false,
    created_at: "2026-10-22T12:00:00Z", updated_at: "2026-10-22T12:00:00Z",
  };
}

function list(items: CustomerOrderListItem[], total = items.length, offset = 0): CustomerOrderListResponse {
  return {
    items, total, offset, limit: 25,
    status_counts: { new: total, confirmed: 0, in_progress: 0, ready: 0, fulfilled: 0, cancelled: 0 },
  };
}

function renderList() {
  return render(<MemoryRouter><CustomerOrderListView /></MemoryRouter>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("CustomerOrderListView", () => {
  beforeEach(() => {
    mocks.online = true;
    mocks.list.mockReset().mockResolvedValue(list([order("PED-PRIMERO")]));
    mocks.readCache.mockReset().mockResolvedValue(undefined);
    mocks.saveCache.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("starts a submitted search on the first page so matching orders remain visible", async () => {
    mocks.list.mockImplementation(async ({ search, offset }: { search?: string; offset: number }) => {
      if (search) return list(offset === 0 ? [order("PED-BUSCADO")] : [], 1, offset);
      return list([order(offset === 0 ? "PED-PRIMERO" : "PED-SEGUNDO")], 26, offset);
    });
    renderList();
    await screen.findByText("PED-PRIMERO");
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await screen.findByText("PED-SEGUNDO");
    fireEvent.change(screen.getByPlaceholderText("Folio, cliente o teléfono"), { target: { value: "  PED-BUSCADO  " } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("PED-BUSCADO")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "PED-BUSCADO", offset: 0 }));
  });

  it("filters by keyboard with one tab stop and resets pagination without creating a different order", async () => {
    mocks.list.mockImplementation(async ({ offset }: { offset: number }) => list([order("PED-PRIMERO")], 26, offset));
    renderList();
    await screen.findByText("PED-PRIMERO");
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })));
    const filter = screen.getByRole("radiogroup", { name: "Estado del pedido" });
    const initial = within(filter).getByRole("radio", { name: "Activos y recientes" });
    initial.focus();
    fireEvent.keyDown(initial, { key: "ArrowRight" });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "new", offset: 0 })));
    const selected = within(filter).getByRole("radio", { name: /^Nuevo/ });
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(within(filter).getAllByRole("radio").filter(radio => radio.tabIndex === 0)).toEqual([selected]);
    fireEvent.keyDown(selected, { key: "Home" });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined, offset: 0 })));
    expect(initial).toHaveFocus();
  });

  it("reports an online query failure and recovers on retry without claiming the device is offline", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Unavailable"));
    renderList();
    expect(await screen.findByText("No pudimos consultar los pedidos. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText("No hay pedidos guardados para consultar sin conexión.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("PED-PRIMERO")).toBeInTheDocument();
  });

  it("ignores an older page response after a newer search resolves, including cache writes", async () => {
    const olderPage = deferred<CustomerOrderListResponse>();
    const latestSearch = deferred<CustomerOrderListResponse>();
    mocks.list
      .mockResolvedValueOnce(list([order("PED-PRIMERO")], 26))
      .mockReturnValueOnce(olderPage.promise)
      .mockReturnValueOnce(latestSearch.promise);
    renderList();
    await screen.findByText("PED-PRIMERO");
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByPlaceholderText("Folio, cliente o teléfono"), { target: { value: "PED-ACTUAL" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
    const latest = list([order("PED-ACTUAL")]);
    await act(async () => latestSearch.resolve(latest));
    expect(screen.getByText("PED-ACTUAL")).toBeInTheDocument();
    await act(async () => olderPage.resolve(list([order("PED-VIEJO")], 26, 25)));
    expect(screen.getByText("PED-ACTUAL")).toBeInTheDocument();
    expect(screen.queryByText("PED-VIEJO")).not.toBeInTheDocument();
    expect(mocks.saveCache).toHaveBeenCalledTimes(2);
    expect(mocks.saveCache).toHaveBeenLastCalledWith("tenant", latest, "branch");
  });

  it("ignores an older cache fallback after the current query succeeds", async () => {
    const fallback = deferred<{ list: CustomerOrderListResponse; cached_at: string }>();
    mocks.list.mockRejectedValueOnce(new Error("Unavailable"));
    mocks.readCache.mockReturnValueOnce(fallback.promise);
    renderList();
    await waitFor(() => expect(mocks.readCache).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText("Folio, cliente o teléfono"), { target: { value: "PRIMERO" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("PED-PRIMERO");
    await act(async () => fallback.resolve({ list: list([order("PED-CACHE-VIEJO")]), cached_at: "2026-10-22T12:00:00Z" }));
    expect(screen.getByText("PED-PRIMERO")).toBeInTheDocument();
    expect(screen.queryByText("PED-CACHE-VIEJO")).not.toBeInTheDocument();
    expect(screen.queryByText(/Solo lectura/)).not.toBeInTheDocument();
  });

  it("does not persist a pending response after leaving the page", async () => {
    const pending = deferred<CustomerOrderListResponse>();
    mocks.list.mockReturnValueOnce(pending.promise);
    const view = renderList();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => pending.resolve(list([order("PED-TARDIO")])));
    expect(mocks.saveCache).not.toHaveBeenCalled();
    expect(mocks.readCache).not.toHaveBeenCalled();
  });

  it("explains missing offline data without attempting a network request", async () => {
    mocks.online = false;
    renderList();
    expect(await screen.findByText("No hay pedidos guardados para consultar sin conexión.")).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("filters cached promised dates by the same local inclusive range as the API", async () => {
    vi.stubEnv("TZ", "America/Mexico_City");
    // A local late-night order belongs to the 22nd even though its UTC date is the 23rd.
    const lateNight = "2026-10-23T05:00:00.000Z";
    const previousNight = "2026-10-22T05:00:00.000Z";
    const midnight = "2026-10-23T06:00:00.000Z";
    const nextDay = "2026-10-23T07:00:00.000Z";
    const items = [
      order("PED-NOCHE", lateNight), order("PED-ANTERIOR", previousNight),
      order("PED-LIMITE", midnight), order("PED-SIGUIENTE", nextDay), order("PED-SIN-FECHA"),
    ];
    mocks.list.mockResolvedValue(list(items));
    renderList();
    await screen.findByText("PED-NOCHE");
    fireEvent.change(screen.getByLabelText("Filtrar por fecha prometida"), { target: { value: "2026-10-22" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({
      promised_from: "2026-10-22T06:00:00.000Z", promised_to: midnight,
    })));
    mocks.online = false;
    mocks.readCache.mockResolvedValue({ list: list(items), cached_at: "2026-10-22T12:00:00Z" });
    // Changing a filter triggers a read from the branch cache after losing connectivity.
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por modalidad" }), { target: { value: "pickup" } });
    await screen.findByText(/Solo lectura/);
    expect(screen.getByText("PED-NOCHE")).toBeInTheDocument();
    expect(screen.getByText("PED-LIMITE")).toBeInTheDocument();
    expect(screen.queryByText("PED-ANTERIOR")).not.toBeInTheDocument();
    expect(screen.queryByText("PED-SIGUIENTE")).not.toBeInTheDocument();
    expect(screen.queryByText("PED-SIN-FECHA")).not.toBeInTheDocument();
    expect(mocks.readCache).toHaveBeenLastCalledWith("tenant", "branch");
  });
});
