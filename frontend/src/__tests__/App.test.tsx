import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { invalidateBillingSubscription } from "@/billing/api";

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

const billingAllowedResponse = {
  plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
  subscription: null,
  access: {
    allowed: true,
    reason: "active",
    trialing: false,
    trial_ends_at: null,
    blocked_at: null,
    recovery_path: "/settings/billing",
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// URL-pattern → response queue. Decouples mock setup from React effect ordering
// so BillingBanner's /billing/subscription fetch does not consume mocks intended
// for RegisterView's product/category/stock fetches.
type FetchMockHandler = unknown | ((init?: RequestInit) => unknown);
function setupFetchMock(routes: Record<string, FetchMockHandler[]>) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([pattern, list]) => [pattern, [...list]]),
  );
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    for (const [pattern, queue] of Object.entries(queues)) {
      if (url.includes(pattern)) {
        const next = queue.shift();
        if (next === undefined) {
          throw new Error(`Exhausted fetch mocks for ${pattern} (called ${url})`);
        }
        const resolved = typeof next === "function" ? (next as (i?: RequestInit) => unknown)(init) : next;
        return jsonResponse(resolved);
      }
    }
    throw new Error(`No fetch mock matched ${url}`);
  });
}

afterEach(() => {
  invalidateBillingSubscription();
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
    expect(await screen.findByRole("heading", { name: /retoma el control/i })).toBeInTheDocument();
    expect(screen.getByText("Plan Standard")).toBeInTheDocument();
  });

  it("lands on register after a successful login", async () => {
    window.history.pushState(null, "", "/login");
    setupFetchMock({
      "/api/v1/auth/login": [{ message: "Logged in." }],
      "/api/v1/auth/session": [authenticatedCashier],
      "/api/v1/billing/subscription": [billingAllowedResponse],
      "/api/v1/catalog/products": [[]],
      "/api/v1/catalog/categories": [[]],
      "/api/v1/inventory/stock": [[]],
    });

    render(<App />);
    fireEvent.change(await screen.findByRole("textbox", { name: /correo/i }), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/contrase/i), {
      target: { value: "testing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /iniciar sesi[oó]n/i }));

    expect(await screen.findByRole("heading", { name: /caja/i })).toBeInTheDocument();
  });

  it("creates a cash sale from the register", async () => {
    window.history.pushState(null, "", "/register");
    setupFetchMock({
      "/api/v1/auth/session": [authenticatedCashier],
      "/api/v1/billing/subscription": [billingAllowedResponse],
      "/api/v1/catalog/products": [sellableProducts],
      "/api/v1/catalog/categories": [[]],
      "/api/v1/inventory/stock": [[]],
      "/api/v1/sync/offline-sales": [syncResponse("order-1")],
    });

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^agregar concha$/i }));
    fireEvent.change(screen.getByLabelText(/efectivo recibido/i), {
      target: { value: "20.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cobrar$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/venta completada/i);
    const openOrderLinks = screen.getAllByRole("link", { name: /abrir orden/i });
    expect(openOrderLinks.length).toBeGreaterThan(0);
    openOrderLinks.forEach((link) => expect(link).toHaveAttribute("href", "/orders/order-1"));
  });

  it("creates a bank transfer sale with a reference", async () => {
    window.history.pushState(null, "", "/register");
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [authenticatedCashier],
      "/api/v1/billing/subscription": [billingAllowedResponse],
      "/api/v1/catalog/products": [sellableProducts],
      "/api/v1/catalog/categories": [[]],
      "/api/v1/inventory/stock": [[]],
      "/api/v1/sync/offline-sales": [syncResponse("order-transfer")],
    });

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^agregar concha$/i }));
    fireEvent.click(screen.getByRole("radio", { name: /transferencia/i }));
    fireEvent.change(screen.getByLabelText(/^referencia$/i), {
      target: { value: "TRANSFER-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cobrar$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/venta completada/i);
    expect(fetchMock).toHaveBeenCalledWith(
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
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [authenticatedCashier],
      "/api/v1/billing/subscription": [billingAllowedResponse],
      "/api/v1/catalog/products": [sellableProducts],
      "/api/v1/catalog/categories": [[]],
      "/api/v1/inventory/stock": [[]],
      "/api/v1/sync/offline-sales": [syncResponse("order-card")],
    });

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^agregar concha$/i }));
    fireEvent.click(screen.getByRole("radio", { name: /tarjeta manual/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cobrar$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/venta completada/i);
    expect(fetchMock).toHaveBeenCalledWith(
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
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [authenticatedCashier],
      "/api/v1/billing/subscription": [billingAllowedResponse],
      "/api/v1/catalog/products": [sellableProducts],
      "/api/v1/catalog/categories": [[]],
      "/api/v1/inventory/stock": [[]],
      "/api/v1/sync/offline-sales": [syncResponse("order-split")],
    });

    render(<App />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^agregar concha$/i }));
    fireEvent.click(screen.getByLabelText(/pago dividido/i));
    fireEvent.change(screen.getAllByLabelText(/^monto$/i)[0], {
      target: { value: "10.00" },
    });
    fireEvent.change(screen.getByLabelText(/efectivo recibido/i), {
      target: { value: "10.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /agregar pago/i }));
    fireEvent.change(screen.getByLabelText(/^referencia$/i), {
      target: { value: "SPEI-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cobrar$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/venta completada/i);
    expect(fetchMock).toHaveBeenCalledWith(
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
