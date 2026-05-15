import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

// ─── Offline module mocks (no IndexedDB in jsdom) ────────────────────────────

vi.mock("../offline/queue", () => ({
  queueOfflineSale: vi.fn(async (sale: unknown) => ({
    client_uuid: "00000000-0000-4000-8000-000000000001",
    status: "pending",
    sale,
    attempt_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
  retryDeadLetter: vi.fn(),
}));

vi.mock("../offline/sync", () => ({
  syncOfflineSales: vi.fn(async (items: Array<{ client_uuid: string; sale: unknown }>) => {
    const response = await fetch("/api/v1/sync/offline-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sales: items.map((item) => ({ client_uuid: item.client_uuid, order: item.sale })),
      }),
    });
    const body = (await response.json()) as { results: unknown[] };
    return body.results;
  }),
}));

vi.mock("../offline/syncWorker", () => ({ triggerSync: vi.fn() }));

vi.mock("../offline/useSyncQueue", () => ({
  useSyncQueue: () => ({ pendingCount: 0, failedEntries: [], syncNow: vi.fn(), retryDeadLetter: vi.fn() }),
  useIsOnline: () => true,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const authenticatedCashier = {
  authenticated: true,
  user: { id: "user-1", email: "cashier@example.com", tenant_id: "tenant-1", role: "cashier" },
  tenant_id: "tenant-1",
  tenant_name: "Testing",
};

const sellableProducts = [
  {
    id: "product-1",
    tenant_id: "tenant-1",
    category_id: null,
    name: "Concha",
    description: null,
    sku: "CON-001",
    price_amount: "18.50",
    track_inventory: false,
    low_stock_threshold: null,
    is_active: true,
    modifier_groups: [],
  },
];

function completedOrder(id: string) {
  return {
    id,
    tenant_id: "tenant-1",
    status: "completed",
    subtotal_amount: "18.50",
    total_amount: "18.50",
    items: [],
    payments: [],
  };
}

function syncResponse(orderId: string) {
  return {
    results: [
      {
        client_uuid: "00000000-0000-4000-8000-000000000001",
        status: "synced",
        order_id: orderId,
        order: completedOrder(orderId),
        error: null,
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("App shell", () => {
  it("renders the public landing page for unauthenticated users", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: /bajo control/i })).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();
  });

  it("lands on register after a successful login", async () => {
    window.history.pushState(null, "", "/login");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Logged in." }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authenticatedCashier), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: /email/i }), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "testing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));

    expect(await screen.findByRole("heading", { name: /register/i })).toBeInTheDocument();
  });

  it("creates a cash sale from the register", async () => {
    window.history.pushState(null, "", "/register");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authenticatedCashier), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sellableProducts), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // categories
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // inventory/stock
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(syncResponse("order-1")), { status: 200 }),
      );

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^add concha$/i }));
    fireEvent.change(screen.getByLabelText(/cash tendered/i), {
      target: { value: "20.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /complete sale/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/sale completed/i);
    expect(screen.getByRole("link", { name: /open order/i })).toHaveAttribute(
      "href",
      "/orders/order-1",
    );
  });

  it("creates a bank transfer sale with a reference", async () => {
    window.history.pushState(null, "", "/register");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authenticatedCashier), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sellableProducts), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // categories
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // inventory/stock
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(syncResponse("order-transfer")), { status: 200 }),
      );

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^add concha$/i }));
    fireEvent.click(screen.getByRole("button", { name: /bank transfer/i }));
    fireEvent.change(screen.getByLabelText(/^reference$/i), {
      target: { value: "TRANSFER-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /complete sale/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/sale completed/i);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/v1/sync/offline-sales"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sales: [
            {
              client_uuid: "00000000-0000-4000-8000-000000000001",
              order: {
                items: [{ product_id: "product-1", quantity: 1, modifier_option_ids: [] }],
                payments: [{ method: "bank_transfer", amount: "18.50", reference: "TRANSFER-001" }],
              },
            },
          ],
        }),
      }),
    );
  });

  it("creates a manual card sale with an optional reference", async () => {
    window.history.pushState(null, "", "/register");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authenticatedCashier), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sellableProducts), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // categories
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // inventory/stock
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(syncResponse("order-card")), { status: 200 }),
      );

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^add concha$/i }));
    fireEvent.click(screen.getByRole("button", { name: /manual card/i }));
    fireEvent.click(screen.getByRole("button", { name: /complete sale/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/sale completed/i);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/v1/sync/offline-sales"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sales: [
            {
              client_uuid: "00000000-0000-4000-8000-000000000001",
              order: {
                items: [{ product_id: "product-1", quantity: 1, modifier_option_ids: [] }],
                payments: [{ method: "manual_card", amount: "18.50" }],
              },
            },
          ],
        }),
      }),
    );
  });

  it("creates a split cash and bank transfer sale", async () => {
    window.history.pushState(null, "", "/register");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authenticatedCashier), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sellableProducts), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // categories
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }), // inventory/stock
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(syncResponse("order-split")), { status: 200 }),
      );

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^add concha$/i }));
    fireEvent.click(screen.getByLabelText(/split payment/i));
    fireEvent.change(screen.getAllByLabelText(/^amount$/i)[0], {
      target: { value: "10.00" },
    });
    fireEvent.change(screen.getByLabelText(/cash tendered/i), {
      target: { value: "10.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add payment/i }));
    fireEvent.change(screen.getByLabelText(/^reference$/i), {
      target: { value: "SPEI-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /complete sale/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/sale completed/i);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/v1/sync/offline-sales"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sales: [
            {
              client_uuid: "00000000-0000-4000-8000-000000000001",
              order: {
                items: [{ product_id: "product-1", quantity: 1, modifier_option_ids: [] }],
                payments: [
                  { method: "cash", amount: "10.00", amount_tendered: "10.00" },
                  { method: "bank_transfer", amount: "8.50", reference: "SPEI-001" },
                ],
              },
            },
          ],
        }),
      }),
    );
  });
});
