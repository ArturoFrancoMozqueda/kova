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

vi.mock("@/shifts/api", () => ({ getOpenShift: () => getOpenShift() }));
vi.mock("../offline/queue", () => ({
  queueOfflineSale: (...args: unknown[]) => queueOfflineSale(...args),
}));
vi.mock("../offline/sync", () => ({
  syncOfflineSales: (...args: unknown[]) => syncOfflineSales(...args),
}));
vi.mock("../offline/syncWorker", () => ({ triggerSync: vi.fn() }));
vi.mock("@/telemetry/funnel", () => ({ trackFunnelEventOnce: vi.fn() }));
vi.mock("../inventory/api", () => ({ listStock: () => Promise.resolve([]) }));

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
  is_active: true,
  modifier_groups: [],
};

vi.mock("../catalog/api", () => ({
  listProducts: () => Promise.resolve([product]),
  listCategories: () => Promise.resolve([]),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    state: { status: "authenticated", tenantName: "Sweet Home", user: { role: "owner" } },
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
    expect(queueOfflineSale).toHaveBeenCalledWith(expect.anything(), "shift-123");
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
});
