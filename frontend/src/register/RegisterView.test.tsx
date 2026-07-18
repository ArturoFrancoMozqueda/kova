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

vi.mock("@/shifts/api", () => ({ getOpenShift: () => getOpenShift() }));
vi.mock("../offline/queue", () => ({
  queueOfflineSale: (...args: unknown[]) => queueOfflineSale(...args),
}));
vi.mock("../offline/sync", () => ({
  syncOfflineSales: (...args: unknown[]) => syncOfflineSales(...args),
}));
vi.mock("../offline/syncWorker", () => ({ triggerSync: vi.fn() }));
vi.mock("../orders/api", () => ({ getReceipt: (...args: unknown[]) => getReceipt(...args) }));
vi.mock("@/telemetry/funnel", () => ({ trackFunnelEventOnce: vi.fn() }));
vi.mock("../inventory/api", () => ({ listStock: () => Promise.resolve([]) }));
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
    getOpenShift.mockReset();
    queueOfflineSale.mockReset();
    syncOfflineSales.mockReset();
    getReceipt.mockReset();
    getReceipt.mockRejectedValue(new Error("no receipt"));
    catalogApi.listProducts.mockResolvedValue([product]);
    catalogApi.listCategories.mockResolvedValue([]);
    catalogCache.readCatalogCache.mockResolvedValue(undefined);
    catalogCache.saveCatalogCache.mockResolvedValue(undefined);
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
      expect.anything(),
      "shift-123",
      expect.anything(),
    );
  });

  it("does not block cash when shift state is unknown (fail open)", async () => {
    getOpenShift.mockRejectedValue(new Error("offline"));
    renderRegister();

    await addProductToCart();
    const cashRadio = screen.getByRole("radio", { name: cashLabel });
    // No banner, no disable: unknown state must keep the register usable offline.
    expect(screen.queryByText(copy.register.noShiftWarning)).not.toBeInTheDocument();
    expect(cashRadio).not.toHaveAttribute("aria-disabled", "true");
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
    fireEvent.click(screen.getByRole("button", { name: copy.register.exactCash }));
    fireEvent.click(screen.getByRole("button", { name: copy.register.completeSale }));

    expect(
      (await screen.findAllByText(copy.register.offlineSaleSavedTitle)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.register.pendingSync).length).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.register.localReceiptNumber("ABCD1234")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 x Concha/).length).toBeGreaterThan(0);
    expect(getReceipt).not.toHaveBeenCalled();
    expect(queueOfflineSale).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({
        business_name: "Sweet Home",
        total_amount: "50.00",
        items: [expect.objectContaining({ product_name: "Concha" })],
      }),
    );

    const printButtons = screen.getAllByRole("button", { name: copy.register.printReceipt });
    fireEvent.click(printButtons[0]);
    expect(printSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
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
