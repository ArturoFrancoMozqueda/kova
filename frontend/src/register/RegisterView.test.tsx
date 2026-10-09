import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
import type { Product } from "@/catalog/types";
import type { Shift } from "@/shifts/types";

// Mocks for every side-effecting dependency RegisterView pulls in.
const getOpenShift = vi.fn();
const queueOfflineSale = vi.fn();
const claimOfflineSale = vi.fn();
const syncOfflineSales = vi.fn();
const getReceipt = vi.fn();
const catalogApi = vi.hoisted(() => ({
  listProducts: vi.fn(),
  listCategories: vi.fn(),
}));
const catalogCache = vi.hoisted(() => ({
  readCatalogCache: vi.fn(),
  saveCatalogCache: vi.fn(),
}));
const telemetry = vi.hoisted(() => ({
  trackFunnelEventOnce: vi.fn(),
  trackSaleValidationBlocked: vi.fn(),
}));
const inventoryApi = vi.hoisted(() => ({ listStock: vi.fn() }));
const cashDrawer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/hardware/useCashDrawer", () => ({
  useCashDrawer: () => ({ device: null, busy: false, message: "", open: cashDrawer.open }),
}));
const scheduleOfflineSyncRetry = vi.hoisted(() => vi.fn());

vi.mock("@/shifts/api", () => ({ getOpenShift: () => getOpenShift() }));
vi.mock("../offline/queue", () => ({
  queueOfflineSale: (...args: unknown[]) => queueOfflineSale(...args),
  claimOfflineSale: (...args: unknown[]) => claimOfflineSale(...args),
}));
vi.mock("../offline/sync", () => ({
  syncOfflineSales: (...args: unknown[]) => syncOfflineSales(...args),
}));
vi.mock("../offline/syncWorker", () => ({ triggerSync: vi.fn(), stopOfflineSync: vi.fn(), scheduleOfflineSyncRetry }));
vi.mock("../orders/api", () => ({ getReceipt: (...args: unknown[]) => getReceipt(...args) }));
vi.mock("@/telemetry/funnel", () => telemetry);
vi.mock("../inventory/api", () => ({ listStock: (...args: unknown[]) => inventoryApi.listStock(...args) }));
vi.mock("../offline/catalogCache", () => ({
  readCatalogCache: (...args: unknown[]) => catalogCache.readCatalogCache(...args),
  saveCatalogCache: (...args: unknown[]) => catalogCache.saveCatalogCache(...args),
}));

const product: Product = {
  id: "product-1",
  tenant_id: "tenant-1",
  category_id: null,
  name: "Concha",
  description: null,
  sku: "PAN-001",
  price_amount: "50.00",
  track_inventory: false,
  low_stock_threshold: 0,
  image_url: null,
  image_position_x: 50,
  image_position_y: 50,
  image_zoom: 1.0,
  is_active: true,
  modifier_groups: [],
};

vi.mock("../catalog/api", () => ({
  listProducts: (...args: unknown[]) => catalogApi.listProducts(...args),
  listCategories: (...args: unknown[]) => catalogApi.listCategories(...args),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      tenantId: "tenant-1",
      tenantName: "Sweet Home",
      user: { role: "owner" },
    },
  }),
}));
vi.mock("../auth/permissions", async () => {
  const actual = await vi.importActual<typeof import("../auth/permissions")>(
    "../auth/permissions",
  );
  return { ...actual, usePermission: () => true };
});

import RegisterView from "./RegisterView";

const openShift: Shift = {
  id: "shift-123",
  status: "open",
} as Shift;

function renderRegister() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RegisterView />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const cashLabel = copy.register.cash;

describe("RegisterView cash-without-shift guard", () => {
  beforeEach(() => {
    cashDrawer.open.mockReset().mockResolvedValue(undefined);
    getOpenShift.mockReset();
    queueOfflineSale.mockReset();
    claimOfflineSale.mockReset();
    claimOfflineSale.mockImplementation(async (_tenantId, clientUuid) => ({ client_uuid: clientUuid }));
    syncOfflineSales.mockReset();
    getReceipt.mockReset();
    getReceipt.mockRejectedValue(new Error("no receipt"));
    catalogApi.listProducts.mockResolvedValue([product]);
    catalogApi.listCategories.mockResolvedValue([]);
    catalogCache.readCatalogCache.mockResolvedValue(undefined);
    catalogCache.saveCatalogCache.mockResolvedValue(undefined);
    inventoryApi.listStock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function addProductToCart() {
    const addButton = await screen.findByRole("button", {
      name: `${copy.register.add} ${product.name}`,
    });
    fireEvent.click(addButton);
  }

  it("opens the drawer only after the current cash sale is acknowledged by the server", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "drawer-sale" });
    syncOfflineSales.mockResolvedValue([{ status: "synced", order: { id: "cash-order", total_amount: "50.00" } }]);
    renderRegister();
    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));
    await waitFor(() => expect(cashDrawer.open).toHaveBeenCalledWith("sale", "", "cash-order"));
    expect(cashDrawer.open).toHaveBeenCalledTimes(1);
  });

  it("does not open the drawer for a queued offline sale", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "pending-drawer-sale" });
    syncOfflineSales.mockResolvedValue([]);
    renderRegister();
    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));
    await waitFor(() => expect(syncOfflineSales).toHaveBeenCalled());
    expect(cashDrawer.open).not.toHaveBeenCalled();
  });

  it("does not open the drawer when confirmation arrives more than ten seconds after checkout", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "slow-drawer-sale" });
    let completeSync: (value: unknown) => void = () => undefined;
    syncOfflineSales.mockImplementation(() => new Promise(resolve => { completeSync = resolve; }));
    renderRegister();
    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));
    await waitFor(() => expect(syncOfflineSales).toHaveBeenCalled());
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11000);
    try {
      completeSync([{ status: "synced", order: { id: "late-order", total_amount: "50.00" } }]);
      await waitFor(() => expect(getReceipt).toHaveBeenCalledWith("late-order"));
      expect(cashDrawer.open).not.toHaveBeenCalled();
    } finally { time.mockRestore(); }
  });

  it("does not open the drawer for a card-only sale", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "card-drawer-sale" });
    syncOfflineSales.mockResolvedValue([{ status: "synced", order: { id: "card-order", total_amount: "50.00" } }]);
    renderRegister();
    await addProductToCart();
    fireEvent.click(screen.getByRole("radio", { name: copy.register.manualCard }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));
    await waitFor(() => expect(syncOfflineSales).toHaveBeenCalled());
    expect(cashDrawer.open).not.toHaveBeenCalled();
  });

  it("uses one Caja h1 with Catálogo and Carrito as section headings", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    expect(await screen.findByRole("heading", { level: 2, name: copy.register.catalog })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: copy.register.title })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: copy.register.cart })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("disables cash and shows the blocking copy when no shift is open", async () => {
    getOpenShift.mockResolvedValue(null);
    renderRegister();

    // Wait for the no-shift banner to confirm shift state resolved to "none".
    expect(await screen.findByText(copy.register.noShiftWarning)).toBeInTheDocument();
    await addProductToCart();

    const cashRadio = screen.getByRole("radio", { name: cashLabel });
    await waitFor(() => expect(cashRadio).toHaveAttribute("aria-disabled", "true"));

    // Clicking the disabled cash method surfaces the reason instead of selecting it.
    fireEvent.click(cashRadio);
    expect(await screen.findByText(copy.register.cashRequiresShift)).toBeInTheDocument();
  });

  it("enables cash and forwards the shift id to the queue when a shift is open", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "c-1" });
    syncOfflineSales.mockResolvedValue([
      { status: "synced", order: { id: "o-1", total_amount: "50.00" } },
    ]);
    renderRegister();

    await addProductToCart();
    const cashRadio = screen.getByRole("radio", { name: cashLabel });
    expect(cashRadio).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    await waitFor(() => expect(queueOfflineSale).toHaveBeenCalledTimes(1));
    expect(queueOfflineSale).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "shift-123",
      expect.anything(),
      "tenant-1",
    );
  });

  it("blocks cash when shift state is unknown so the sale cannot miss drawer reconciliation", async () => {
    getOpenShift.mockRejectedValue(new Error("offline"));
    renderRegister();

    await addProductToCart();
    const cashRadio = screen.getByRole("radio", { name: cashLabel });
    expect((await screen.findAllByText(copy.register.cashShiftUnknown)).length).toBeGreaterThan(0);
    expect(cashRadio).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: copy.register.bankTransfer })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows neutral cash guidance before interaction and keeps the financial guard", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    await addProductToCart();

    const cashInput = screen.getByLabelText(copy.register.amountTendered);
    expect(screen.getByText(copy.register.cashTenderedHint)).toBeInTheDocument();
    expect(screen.queryByText(copy.register.cashTooLow)).not.toBeInTheDocument();
    expect(cashInput).not.toHaveAttribute("aria-invalid", "true");
    expect(cashInput).toHaveAttribute("aria-describedby", "cashTendered-help");
    const submit = screen.getByRole("button", { name: copy.register.completeSale });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    expect(telemetry.trackSaleValidationBlocked).not.toHaveBeenCalled();
  });

  it("reveals and tracks insufficient cash only after input, blur, or a charge attempt", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    await addProductToCart();
    const cashInput = screen.getByLabelText(copy.register.amountTendered);

    fireEvent.change(cashInput, { target: { value: "20.00" } });
    expect(screen.getByText(copy.register.cashTooLow)).toBeInTheDocument();
    expect(cashInput).toHaveAttribute("aria-invalid", "true");
    expect(cashInput).toHaveAttribute("aria-describedby", "cashTendered-error");
    expect(telemetry.trackSaleValidationBlocked).toHaveBeenCalledTimes(1);
    expect(telemetry.trackSaleValidationBlocked).toHaveBeenCalledWith(
      "cash_tendered",
      "insufficient_cash",
    );

    fireEvent.change(cashInput, { target: { value: "" } });
    fireEvent.blur(cashInput);
    expect(screen.getByText(copy.register.cashTooLow)).toBeInTheDocument();
    expect(telemetry.trackSaleValidationBlocked).toHaveBeenCalledTimes(1);
  });

  it("reveals empty-cash guidance as an error only when the disabled charge is attempted", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    await addProductToCart();
    const submit = screen.getByRole("button", { name: copy.register.completeSale });
    expect(screen.queryByText(copy.register.cashTooLow)).not.toBeInTheDocument();

    fireEvent.click(submit);

    expect(screen.getByText(copy.register.cashTooLow)).toBeInTheDocument();
    expect(telemetry.trackSaleValidationBlocked).toHaveBeenCalledWith(
      "cash_tendered",
      "insufficient_cash",
    );
    expect(queueOfflineSale).not.toHaveBeenCalled();
  });

  it("clears cash interaction state when the payment method changes or the cart empties", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    await addProductToCart();
    const submit = screen.getByRole("button", { name: copy.register.completeSale });
    const cashInput = screen.getByLabelText(copy.register.amountTendered);
    fireEvent.change(cashInput, { target: { value: "10.00" } });
    expect(screen.getByText(copy.register.cashTooLow)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: copy.register.bankTransfer }));
    fireEvent.click(screen.getByRole("radio", { name: copy.register.cash }));
    expect(screen.getByLabelText(copy.register.amountTendered)).toHaveValue(null);
    expect(screen.getByText(copy.register.cashTenderedHint)).toBeInTheDocument();
    expect(screen.queryByText(copy.register.cashTooLow)).not.toBeInTheDocument();

    fireEvent.click(submit);
    expect(screen.getByText(copy.register.cashTooLow)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.register.removeItem(product.name) }));
    await screen.findByText(copy.register.paymentEmptyTitle);

    await addProductToCart();
    expect(screen.getByText(copy.register.cashTenderedHint)).toBeInTheDocument();
    expect(screen.queryByText(copy.register.cashTooLow)).not.toBeInTheDocument();
  });

  it("restores an undone cart line at its original position", async () => {
    // Object spread appends, so the previous undo moved a middle line to the
    // bottom of the cart. Invisible before; obvious now that the row collapses
    // in place and would reappear somewhere else.
    getOpenShift.mockResolvedValue(openShift);
    const secondProduct: Product = { ...product, id: "product-2", name: "Bolillo", sku: "PAN-002" };
    catalogApi.listProducts.mockResolvedValue([product, secondProduct]);
    renderRegister();

    await addProductToCart();
    fireEvent.click(
      await screen.findByRole("button", { name: `${copy.register.add} ${secondProduct.name}` }),
    );

    const cart = screen.getByLabelText(copy.register.cart);
    const lineOrder = () => {
      const text = cart.textContent ?? "";
      return [product.name, secondProduct.name].sort(
        (left, right) => text.indexOf(left) - text.indexOf(right),
      );
    };
    expect(lineOrder()).toEqual([product.name, secondProduct.name]);

    fireEvent.click(screen.getByRole("button", { name: copy.register.removeItem(product.name) }));
    fireEvent.click(await screen.findByRole("button", { name: copy.register.undo }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: copy.register.removeItem(product.name) }),
      ).toBeInTheDocument(),
    );
    expect(lineOrder()).toEqual([product.name, secondProduct.name]);
  });

  it("locks cart and payment edits while saving, then keeps the draft if saving fails", async () => {
    getOpenShift.mockResolvedValue(openShift);
    let rejectSave!: (reason: Error) => void;
    queueOfflineSale.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));
    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    const add = screen.getByRole("button", { name: `${copy.register.add} ${product.name}` });
    const increase = screen.getByRole("button", { name: copy.register.increaseQuantity });
    const remove = screen.getByRole("button", { name: copy.register.removeItem(product.name) });
    const cash = screen.getByLabelText(copy.register.amountTendered);
    expect(add).toBeDisabled();
    expect(increase).toBeDisabled();
    expect(remove).toBeDisabled();
    expect(cash).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /pago dividido/i })).toBeDisabled();

    // Programmatic callbacks and global shortcuts must respect the same lock.
    fireEvent.click(add);
    fireEvent.click(increase);
    fireEvent.click(remove);
    fireEvent.keyDown(document.body, { key: "2", altKey: true });
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    expect(queueOfflineSale).toHaveBeenCalledTimes(1);
    expect(queueOfflineSale.mock.calls[0][1]).toMatchObject({
      items: [{ product_id: product.id, quantity: 1 }],
      payments: [{ method: "cash", amount: "50.00", amount_tendered: "50.00" }],
    });

    rejectSave(new Error("storage unavailable"));
    expect(await screen.findByText(copy.register.saleError)).toBeVisible();
    expect(add).not.toBeDisabled();
    expect(cash).toHaveValue(50);
    expect(remove).toBeVisible();
    fireEvent.click(increase);
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    expect(cash).toHaveValue(100);
  });

  it("does not let an old undo action put a removed product into the next sale", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "saved-sale" });
    syncOfflineSales.mockResolvedValue([]);
    const secondProduct = { ...product, id: "product-2", name: "Bolillo", sku: "PAN-002" };
    catalogApi.listProducts.mockResolvedValue([product, secondProduct]);
    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: `${copy.register.add} ${secondProduct.name}` }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.removeItem(product.name) }));
    const undo = await screen.findByRole("button", { name: copy.register.undo });
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));
    await screen.findByRole("dialog", { name: copy.register.offlineSaleSavedTitle });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByText(copy.register.paymentEmptyTitle)).toBeVisible());
    fireEvent.click(undo);

    expect(screen.getByText(copy.register.paymentEmptyTitle)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("button", {
      name: copy.register.removeItem(product.name),
    })).not.toBeInTheDocument());
  });

  it("requires explicit cash received when switching to split payments", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();
    await addProductToCart();
    fireEvent.click(screen.getByRole("checkbox", { name: /pago dividido/i }));

    expect(screen.getByLabelText(copy.register.amountTendered)).toHaveValue(null);
    expect(screen.getByText(copy.register.splitCashShort)).toBeVisible();
    expect(screen.getByRole("button", { name: copy.register.completeSale })).toBeDisabled();
    expect(queueOfflineSale).not.toHaveBeenCalled();
  });

  it("does not submit the underlying cart while a product modifier dialog is open", async () => {
    getOpenShift.mockResolvedValue(openShift);
    const customizedProduct: Product = {
      ...product,
      id: "product-customized",
      name: "Café",
      sku: "CAFE-001",
      modifier_groups: [{
        id: "milk", tenant_id: "tenant-1", name: "Leche", is_required: true,
        min_selections: 1, max_selections: 1, sort_order: 0, is_active: true,
        options: [{
          id: "whole", group_id: "milk", name: "Entera", price_delta: "0.00",
          sort_order: 0, is_active: true,
        }],
      }],
    };
    catalogApi.listProducts.mockResolvedValue([product, customizedProduct]);
    renderRegister();
    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: `${copy.register.add} ${customizedProduct.name}` }));
    expect(await screen.findByRole("dialog", { name: /Café/ })).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    expect(queueOfflineSale).not.toHaveBeenCalled();
  });

  it("preserves entered cash and change when switching to split payments", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "split-sale" });
    syncOfflineSales.mockResolvedValue([]);
    renderRegister();
    await addProductToCart();
    fireEvent.change(screen.getByLabelText(copy.register.amountTendered), { target: { value: "100.00" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /pago dividido/i }));
    expect(screen.getByLabelText(copy.register.amountTendered)).toHaveValue(100);
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    await waitFor(() => expect(queueOfflineSale).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ payments: [{ method: "cash", amount: "50.00", amount_tendered: "100.00" }] }),
      "shift-123",
      expect.objectContaining({ total_tendered: "100.00", total_change: "50.00" }),
      "tenant-1",
    ));
  });

  it("removes a line without updating ToastProvider from the cart updater", async () => {
    getOpenShift.mockResolvedValue(openShift);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.removeItem(product.name) }));

    expect(await screen.findByText(copy.register.itemRemoved(product.name))).toBeInTheDocument();
    expect(
      errorSpy.mock.calls.some((call) =>
        call.some((value) => String(value).includes("Cannot update a component")),
      ),
    ).toBe(false);
    errorSpy.mockRestore();
  });

  it("renders the saved catalog when product and category fetches fail offline", async () => {
    getOpenShift.mockRejectedValue(new Error("offline"));
    catalogApi.listProducts.mockRejectedValue(new Error("offline"));
    catalogApi.listCategories.mockRejectedValue(new Error("offline"));
    catalogCache.readCatalogCache.mockResolvedValue({
      tenant_id: "tenant-1",
      products: [product],
      categories: [],
      cached_at: "2026-07-09T16:30:00.000Z",
    });

    renderRegister();

    expect(await screen.findByText(copy.register.offlineCatalogNotice)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: `${copy.register.add} ${product.name}` }),
    ).toBeInTheDocument();
    expect(catalogCache.readCatalogCache).toHaveBeenCalledWith("tenant-1");
  });

  it("shows the register load error when offline cache is unavailable", async () => {
    getOpenShift.mockRejectedValue(new Error("offline"));
    catalogApi.listProducts.mockRejectedValue(new Error("offline"));
    catalogApi.listCategories.mockRejectedValue(new Error("offline"));
    catalogCache.readCatalogCache.mockResolvedValue(undefined);

    renderRegister();

    expect(await screen.findByText(copy.register.loadError)).toBeInTheDocument();
    expect(screen.queryByText(copy.register.offlineCatalogNotice)).not.toBeInTheDocument();
  });

  it("adds a keyboard-wedge scan on Enter without waiting for the debounce", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    const scanner = await screen.findByPlaceholderText(copy.register.skuSearchPlaceholder);
    fireEvent.change(scanner, { target: { value: "PAN-001" } });
    fireEvent.keyDown(scanner, { key: "Enter" });

    expect(screen.getByRole("button", { name: copy.register.removeItem(product.name) })).toBeVisible();
    expect(scanner).toHaveValue("");
    await waitFor(() => expect(scanner).toHaveFocus());
  });

  it("accepts consecutive scans without duplicating the delayed callback", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    const scanner = await screen.findByPlaceholderText(copy.register.skuSearchPlaceholder);
    fireEvent.change(scanner, { target: { value: "PAN-001" } });
    fireEvent.keyDown(scanner, { key: "Enter" });
    fireEvent.change(scanner, { target: { value: "PAN-001" } });
    fireEvent.keyDown(scanner, { key: "Enter" });

    const cart = screen.getByLabelText(copy.register.cart);
    await waitFor(() => expect(cart).toHaveTextContent("2"));
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    expect(cart).toHaveTextContent("2");
  });

  it("does not exceed known stock through SKU scans or the quantity control", async () => {
    getOpenShift.mockResolvedValue(openShift);
    inventoryApi.listStock.mockResolvedValue([{
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      track_inventory: true,
      stock_on_hand: 1,
      reserved_quantity: 0,
      available_quantity: 1,
      low_stock_threshold: 0,
      is_low_stock: false,
    }]);
    renderRegister();

    const scanner = await screen.findByPlaceholderText(copy.register.skuSearchPlaceholder);
    await waitFor(() => expect(screen.getByRole("button", { name: `${copy.register.add} ${product.name}` })).toBeVisible());
    fireEvent.change(scanner, { target: { value: product.sku } });
    fireEvent.keyDown(scanner, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: copy.register.increaseQuantity }));

    const cart = screen.getByLabelText(copy.register.cart);
    expect(cart).toHaveTextContent("1");
    expect(await screen.findByText(copy.register.outOfStockBlocked(product.name))).toBeVisible();
  });

  it("respects a manual sheet collapse when another cart line is added", async () => {
    getOpenShift.mockResolvedValue(openShift);
    const secondProduct = { ...product, id: "product-2", name: "Bolillo", sku: "PAN-002" };
    catalogApi.listProducts.mockResolvedValue([product, secondProduct]);
    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.collapseCart }));
    fireEvent.click(screen.getByRole("button", { name: `${copy.register.add} ${secondProduct.name}` }));

    expect(screen.getByRole("button", { name: copy.register.expandCart })).toHaveAttribute("aria-expanded", "false");
  });

  it("moves focus into the mobile sale summary and closes it with Escape", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();

    const addButton = await screen.findByRole("button", { name: `${copy.register.add} ${product.name}` });
    addButton.focus();
    fireEvent.click(addButton);
    const dialog = await screen.findByRole("dialog", { name: copy.register.cartSheetTitle });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: copy.register.cartSheetTitle })).not.toBeInTheDocument();
    expect(addButton).toHaveFocus();
  });

  it("gives the SKU clear action an accessible name", async () => {
    getOpenShift.mockResolvedValue(openShift);
    renderRegister();
    const scanner = await screen.findByPlaceholderText(copy.register.skuSearchPlaceholder);
    fireEvent.change(scanner, { target: { value: "PAN" } });
    expect(screen.getByRole("button", { name: copy.register.clearSkuSearch })).toBeVisible();
  });

  it("does not choose between duplicate exact SKUs and reports a no-match after lookup", async () => {
    getOpenShift.mockResolvedValue(openShift);
    const duplicate: Product = {
      ...product,
      id: "product-duplicate",
      name: "Concha grande",
    };
    catalogApi.listProducts.mockResolvedValue([product, duplicate]);
    renderRegister();

    const scanner = await screen.findByPlaceholderText(copy.register.skuSearchPlaceholder);
    fireEvent.change(scanner, { target: { value: "PAN-001" } });
    fireEvent.keyDown(scanner, { key: "Enter" });

    expect(await screen.findByText(copy.register.skuMultipleMatches)).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.register.removeItem(product.name) })).not.toBeInTheDocument();

    fireEvent.change(scanner, { target: { value: "NO-EXISTE" } });
    fireEvent.keyDown(scanner, { key: "Enter" });
    expect(await screen.findByText(copy.register.skuNoMatch("NO-EXISTE"))).toBeVisible();
  });

  it("scans from the tenant catalog cache while offline", async () => {
    getOpenShift.mockRejectedValue(new Error("offline"));
    catalogApi.listProducts.mockRejectedValue(new Error("offline"));
    catalogApi.listCategories.mockRejectedValue(new Error("offline"));
    catalogCache.readCatalogCache.mockResolvedValue({
      tenant_id: "tenant-1",
      products: [product],
      categories: [],
      cached_at: "2026-07-09T16:30:00.000Z",
    });
    renderRegister();

    const scanner = await screen.findByPlaceholderText(copy.register.skuSearchPlaceholder);
    fireEvent.change(scanner, { target: { value: "PAN-001" } });
    fireEvent.keyDown(scanner, { key: "Enter" });

    expect(screen.getByRole("button", { name: copy.register.removeItem(product.name) })).toBeVisible();
    expect(screen.getByText(copy.register.offlineCatalogNotice)).toBeVisible();
  });

  it("shows the receipt and prints it in one tap after a synced sale", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "c-1" });
    syncOfflineSales.mockResolvedValue([
      { status: "synced", order: { id: "o-1", total_amount: "50.00" } },
    ]);
    getReceipt.mockResolvedValue({
      order_id: "o-1",
      receipt_number: "A-000123",
      tenant_name: "Sweet Home",
      created_at: "2026-07-09T16:30:00.000Z",
      status: "completed",
      items: [
        {
          product_name: "Concha",
          quantity: 1,
          unit_price_amount: "50.00",
          line_total_amount: "50.00",
          modifiers: [],
        },
      ],
      subtotal_amount: "50.00",
      total_amount: "50.00",
      payments: [
        {
          method: "cash",
          amount_amount: "50.00",
          amount_tendered_amount: "50.00",
          change_due_amount: "0.00",
          reference: null,
        },
      ],
      total_tendered: "50.00",
      total_change: "0.00",
      refunds: [],
      void: null,
    });
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    await waitFor(() => expect(getReceipt).toHaveBeenCalledWith("o-1"));

    // Receipt number renders (desktop + mobile success blocks are both mounted).
    const printButtons = await screen.findAllByRole("button", {
      name: copy.register.printReceipt,
    });
    expect(printButtons.length).toBeGreaterThan(0);
    expect(screen.getAllByText("A-000123").length).toBeGreaterThan(0);

    fireEvent.click(printButtons[0]);
    expect(printSpy).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("prints a clearly marked local receipt before an offline sale syncs", async () => {
    getOpenShift.mockRejectedValue(new Error("offline"));
    queueOfflineSale.mockImplementation(
      async (_sale: unknown, _shiftId: unknown, receiptSnapshot: unknown) => ({
        client_uuid: "abcd1234-0000-4000-8000-000000000001",
        receipt_snapshot: receiptSnapshot,
      }),
    );
    syncOfflineSales.mockRejectedValue(new TypeError("Failed to fetch"));
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("radio", { name: copy.register.bankTransfer }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    expect(
      (await screen.findAllByText(copy.register.offlineSaleSavedTitle)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.register.pendingSync).length).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.register.localReceiptNumber("ABCD1234")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 x Concha/).length).toBeGreaterThan(0);
    expect(getReceipt).not.toHaveBeenCalled();
    expect(queueOfflineSale).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      undefined,
      expect.objectContaining({
        business_name: "Sweet Home",
        total_amount: "50.00",
        items: [expect.objectContaining({ product_name: "Concha" })],
      }),
      "tenant-1",
    );

    const printButtons = screen.getAllByRole("button", { name: copy.register.printReceipt });
    fireEvent.click(printButtons[0]);
    expect(printSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("schedules recovery when foreground sync fails while the browser stays online", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "pending-sale" });
    const failure = new Error("Sync failed with status 503");
    syncOfflineSales.mockRejectedValue(failure);
    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    await waitFor(() => expect(scheduleOfflineSyncRetry).toHaveBeenCalledWith("tenant-1", failure));
    expect(queueOfflineSale).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: copy.register.removeItem(product.name) })).not.toBeInTheDocument(), { timeout: 5_000 });
    expect(screen.getAllByText(copy.register.offlineSaleSavedTitle).length).toBeGreaterThan(0);
  });

  it("preserves the original failed sale instead of restoring a cart that creates a second identity", async () => {
    getOpenShift.mockResolvedValue(openShift);
    queueOfflineSale.mockResolvedValue({ client_uuid: "failed-sale" });
    syncOfflineSales.mockResolvedValue([{
      client_uuid: "failed-sale",
      status: "failed",
      order_id: null,
      order: null,
      error: "OUT_OF_STOCK",
    }]);
    renderRegister();

    await addProductToCart();
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    await waitFor(() => expect(screen.getAllByText(copy.register.saleRejected).length).toBeGreaterThan(0));
    expect(screen.getAllByText(copy.register.offlineSaleSavedTitle).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: copy.register.viewQueue }).every(link => link.getAttribute("href") === "/sync-queue")).toBe(true);

    // Start the next sale, then attempt to charge: the rejected payment must
    // not reappear as a fresh cart or acquire a second queue UUID.
    fireEvent.click(screen.getAllByRole("button", { name: copy.register.newSale })[0]);
    expect(screen.getByRole("button", { name: copy.register.completeSale })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));
    expect(queueOfflineSale).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterView cache-first catalog", () => {
  const cachedProduct: Product = { ...product, id: "product-cached", name: "Concha", sku: "PAN-001" };
  const freshProduct: Product = { ...product, id: "product-fresh", name: "Bolillo", sku: "PAN-002" };
  const cachedCatalog = {
    tenant_id: "tenant-1",
    products: [cachedProduct],
    categories: [],
    cached_at: "2026-07-17T16:30:00.000Z",
  };

  beforeEach(() => {
    getOpenShift.mockResolvedValue(openShift);
    getReceipt.mockRejectedValue(new Error("no receipt"));
    catalogCache.readCatalogCache.mockResolvedValue(cachedCatalog);
    catalogCache.saveCatalogCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("paints the cached catalog before the network resolves, without the offline notice", async () => {
    // Network fetch that never settles during the assertion window.
    let resolveProducts: (products: Product[]) => void = () => undefined;
    catalogApi.listProducts.mockImplementation(
      () => new Promise<Product[]>((resolve) => (resolveProducts = resolve)),
    );
    catalogApi.listCategories.mockResolvedValue([]);

    renderRegister();

    // Cached product is usable while the request is still in flight...
    expect(
      await screen.findByRole("button", { name: `${copy.register.add} ${cachedProduct.name}` }),
    ).toBeInTheDocument();
    // ...and the offline notice is NOT shown: the network verdict isn't in yet.
    expect(screen.queryByText(copy.register.offlineCatalogNotice)).not.toBeInTheDocument();

    resolveProducts([cachedProduct]);
  });

  it("replaces the cached catalog and re-saves the cache when the fetch resolves", async () => {
    catalogApi.listProducts.mockResolvedValue([freshProduct]);
    catalogApi.listCategories.mockResolvedValue([]);

    renderRegister();

    expect(
      await screen.findByRole("button", { name: `${copy.register.add} ${freshProduct.name}` }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `${copy.register.add} ${cachedProduct.name}` }))
        .not.toBeInTheDocument(),
    );
    expect(screen.queryByText(copy.register.offlineCatalogNotice)).not.toBeInTheDocument();
    expect(catalogCache.saveCatalogCache).toHaveBeenCalledWith("tenant-1", [freshProduct], []);
  });

  it("keeps the cached catalog and shows the offline notice when the fetch fails", async () => {
    catalogApi.listProducts.mockRejectedValue(new Error("offline"));
    catalogApi.listCategories.mockRejectedValue(new Error("offline"));

    renderRegister();

    expect(await screen.findByText(copy.register.offlineCatalogNotice)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${copy.register.add} ${cachedProduct.name}` }),
    ).toBeInTheDocument();
  });
});
