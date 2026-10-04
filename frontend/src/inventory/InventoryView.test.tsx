import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
import InventoryView from "./InventoryView";
import { adjustStock, listLowStock, listStock, listVelocity, recordStockTake, updateLowStockThreshold } from "./api";
import type { StockItem } from "./types";

const authIdentity = vi.hoisted(() => ({ tenantId: "tenant-1", user: { id: "user-1" } }));
vi.mock("../auth/useAuth", () => ({ useOptionalAuth: () => ({ state: { status: "authenticated", ...authIdentity } }) }));

vi.mock("../auth/permissions", () => ({
  INVENTORY_ADJUST_PERMISSION: "inventory.adjust",
  usePermission: () => true,
}));
vi.mock("./api", () => ({
  adjustStock: vi.fn(),
  listLowStock: vi.fn(),
  listMovements: vi.fn(),
  listStock: vi.fn(),
  listVelocity: vi.fn(),
  recordStockTake: vi.fn(),
  updateLowStockThreshold: vi.fn(),
}));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn(async () => []) }));

const item: StockItem = {
  product_id: "product-1",
  product_name: "Café",
  sku: "CAF-1",
  track_inventory: true,
  stock_on_hand: 10,
  reserved_quantity: 0,
  available_quantity: 10,
  low_stock_threshold: 2,
  is_low_stock: false,
};

function renderView() {
  return render(<MemoryRouter><ToastProvider><InventoryView /></ToastProvider></MemoryRouter>);
}

async function openModal(action = copy.inventoryView.adjust) {
  renderView();
  await screen.findByRole("heading", { name: item.product_name });
  fireEvent.click(screen.getByRole("button", { name: action }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.resetAllMocks();
  authIdentity.tenantId = "tenant-1";
  authIdentity.user.id = "user-1";
  vi.mocked(listStock).mockResolvedValue([item]);
  vi.mocked(listLowStock).mockResolvedValue([]);
  vi.mocked(listVelocity).mockResolvedValue([]);
});

describe("inventory write safety", () => {
  it.each(["0", "1.5", "9007199254740992", "-11", "2147483648", "-2147483649", "2147483638"])("blocks an invalid adjustment of %s before calling the API", async (amount) => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.quantityDelta), { target: { value: amount } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Compra" } });

    expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(adjustStock).not.toHaveBeenCalled();
  });

  it.each([copy.inventoryView.stockTake, copy.inventoryView.setThreshold])("blocks a negative quantity in %s", async (action) => {
    const dialog = await openModal(action);
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "-1" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/negativ/);
    expect(recordStockTake).not.toHaveBeenCalled();
    expect(updateLowStockThreshold).not.toHaveBeenCalled();
  });

  it.each([copy.inventoryView.stockTake, copy.inventoryView.setThreshold])("limits %s to the INTEGER contract and allows its boundary", async (action) => {
    const dialog = await openModal(action);
    const amount = within(dialog).getByRole("spinbutton");
    expect(amount).toHaveAttribute("max", "2147483647");
    expect(amount).toHaveAttribute("min", "0");
    fireEvent.change(amount, { target: { value: "2147483648" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(recordStockTake).not.toHaveBeenCalled();
    expect(updateLowStockThreshold).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("límite permitido");
    fireEvent.change(amount, { target: { value: "2147483647" } });
    if (action === copy.inventoryView.stockTake) {
      fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Conteo físico" } });
    }
    expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled();
  });

  it("bounds an adjustment by current stock and allows reaching the maximum exactly", async () => {
    const dialog = await openModal();
    const amount = within(dialog).getByRole("spinbutton");
    expect(amount).toHaveAttribute("min", "-10");
    expect(amount).toHaveAttribute("max", "2147483637");
    fireEvent.change(amount, { target: { value: "2147483637" } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Compra" } });
    expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled();
  });

  it("requires an outgoing reason code and allows a typed withdrawal down to zero", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.quantityDelta), { target: { value: "-10" } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Caducidad" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(adjustStock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(copy.inventoryModal.reasonCodeRequired);
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reasonCode), { target: { value: "caducidad" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(adjustStock).toHaveBeenCalledWith(item.product_id, -10, "Caducidad", "caducidad", expect.any(String)));
  });

  it.each([copy.inventoryView.stockTake, copy.inventoryView.setThreshold])("blocks fractional quantities in %s", async (action) => {
    const dialog = await openModal(action);
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "2.5" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("cantidad entera");
    expect(recordStockTake).not.toHaveBeenCalled();
    expect(updateLowStockThreshold).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only reasons and trims a valid reason", async () => {
    vi.mocked(adjustStock).mockResolvedValue({ id: "movement-1", product_id: item.product_id, movement_type: "adjustment", quantity_delta: 3, stock_on_hand: 13, reason: "Compra" });
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.quantityDelta), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "   " } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(adjustStock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("motivo");

    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "  Compra  " } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(adjustStock).toHaveBeenCalledWith(item.product_id, 3, "Compra", null, expect.any(String)));
  });

  it("clears an outgoing reason code when an adjustment changes to incoming stock", async () => {
    const dialog = await openModal();
    const amount = within(dialog).getByLabelText(copy.inventoryModal.quantityDelta);
    fireEvent.change(amount, { target: { value: "-2" } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reasonCode), { target: { value: "merma" } });
    fireEvent.change(amount, { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Compra" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(adjustStock).toHaveBeenCalledWith(item.product_id, 3, "Compra", null, expect.any(String)));
  });

  it("keeps a pending write open and prevents duplicate submissions", async () => {
    let rejectWrite!: (cause: Error) => void;
    vi.mocked(adjustStock).mockImplementation(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.quantityDelta), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Compra" } });
    const form = dialog.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(adjustStock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("spinbutton")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: copy.inventoryModal.cancel })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => { rejectWrite(new Error("connection failed")); });
    expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled();
    expect(within(dialog).getByLabelText(copy.inventoryModal.reason)).toHaveValue("Compra");
  });

  it.each([copy.inventoryView.stockTake, copy.inventoryView.setThreshold])("allows a valid zero in %s", async (action) => {
    const dialog = await openModal(action);
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "0" } });
    if (action === copy.inventoryView.stockTake) {
      fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: "Conteo físico" } });
    }
    expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled();
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => {
      if (action === copy.inventoryView.stockTake) expect(recordStockTake).toHaveBeenCalledWith(item.product_id, 0, "Conteo físico", expect.any(String));
      else expect(updateLowStockThreshold).toHaveBeenCalledWith(item.product_id, 0, expect.any(String));
    });
  });
});

describe("inventory stock visibility", () => {
  it("includes depleted products without thresholds in low stock and excludes them from healthy stock", async () => {
    vi.mocked(listStock).mockResolvedValue([item, { ...item, product_id: "product-2", product_name: "Agua", stock_on_hand: 0, low_stock_threshold: null }]);
    renderView();
    await screen.findByRole("heading", { name: "Agua" });
    fireEvent.change(screen.getByLabelText(copy.inventoryView.filterStock), { target: { value: "healthy" } });
    expect(screen.queryByRole("heading", { name: "Agua" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: item.product_name })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.inventoryView.filterStock), { target: { value: "low" } });
    expect(screen.getByRole("heading", { name: "Agua" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: item.product_name })).not.toBeInTheDocument();
  });

  it("shows homonymous products separately while deduplicating low-stock and velocity alerts for the same product", async () => {
    const first = { ...item, stock_on_hand: 1, is_low_stock: true };
    const second = { ...first, product_id: "product-2", sku: "CAF-2" };
    vi.mocked(listStock).mockResolvedValue([first, second]);
    vi.mocked(listLowStock).mockResolvedValue([first, second]);
    vi.mocked(listVelocity).mockResolvedValue([{ product_id: first.product_id, product_name: first.product_name, stock_on_hand: 1, units_per_day_7d: "2", days_until_out: "0.5" }]);
    renderView();
    await screen.findAllByRole("heading", { name: item.product_name });
    expect(screen.getAllByRole("button", { name: `${copy.inventoryModal.adjustmentTitle}: ${item.product_name}` })).toHaveLength(2);
  });
});

describe("inventory ambiguous-response retries", () => {
  function submitAdjustment(reason = "Compra", amount = "3") {
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.quantityDelta), { target: { value: amount } });
    fireEvent.change(within(dialog).getByLabelText(copy.inventoryModal.reason), { target: { value: reason } });
    fireEvent.submit(dialog.querySelector("form")!);
  }

  it("replays a processed adjustment after closing/reopening instead of applying stock twice, then rotates after success", async () => {
    const processed = new Map<string, number>();
    vi.mocked(adjustStock).mockImplementation(async (productId, delta, reason, _code, key) => {
      if (!processed.has(key!)) {
        processed.set(key!, delta);
        if (processed.size === 1) throw new TypeError("Response lost after commit");
      }
      return { id: "movement-1", product_id: productId, movement_type: "adjustment", quantity_delta: delta, stock_on_hand: 13, reason };
    });
    const dialog = await openModal();
    submitAdjustment();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled());
    expect(processed.size).toBe(1);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.inventoryModal.cancel }));
    fireEvent.click(screen.getByRole("button", { name: copy.inventoryView.adjust }));
    submitAdjustment();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(processed.size).toBe(1);
    expect(vi.mocked(adjustStock).mock.calls[0][4]).toBe(vi.mocked(adjustStock).mock.calls[1][4]);

    await screen.findByRole("button", { name: copy.inventoryView.adjust });
    fireEvent.click(screen.getByRole("button", { name: copy.inventoryView.adjust }));
    submitAdjustment();
    await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(3));
    expect(processed.size).toBe(2);
    expect(vi.mocked(adjustStock).mock.calls[2][4]).not.toBe(vi.mocked(adjustStock).mock.calls[1][4]);
  });

  it("creates a new key when the retry payload changes", async () => {
    vi.mocked(adjustStock).mockRejectedValue(new TypeError("Response lost"));
    const dialog = await openModal();
    submitAdjustment();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled());
    submitAdjustment("Otra compra", "4");
    await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(2));
    expect(vi.mocked(adjustStock).mock.calls[0][4]).not.toBe(vi.mocked(adjustStock).mock.calls[1][4]);
  });

  it.each(["tenantId", "userId"])("clears retry state when %s changes", async (change) => {
    vi.mocked(adjustStock).mockRejectedValue(new TypeError("Response lost"));
    const { rerender } = renderView();
    await screen.findByRole("button", { name: copy.inventoryView.adjust });
    fireEvent.click(screen.getByRole("button", { name: copy.inventoryView.adjust }));
    submitAdjustment();
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: copy.inventoryModal.submit })).toBeEnabled());
    if (change === "tenantId") authIdentity.tenantId = "tenant-2";
    else authIdentity.user.id = "user-2";
    rerender(<MemoryRouter><ToastProvider><InventoryView /></ToastProvider></MemoryRouter>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.inventoryView.adjust }));
    submitAdjustment();
    await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(2));
    expect(vi.mocked(adjustStock).mock.calls[0][4]).not.toBe(vi.mocked(adjustStock).mock.calls[1][4]);
  });
});
