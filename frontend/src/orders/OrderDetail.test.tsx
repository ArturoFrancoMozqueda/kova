import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { invalidateBillingSubscription } from "@/billing/api";

const order = {
  id: "order-1",
  tenant_id: "tenant-1",
  status: "completed",
  subtotal_amount: "50.00",
  total_amount: "50.00",
  items: [
    {
      id: "item-1",
      product_id: "product-1",
      product_name: "Concha",
      quantity: 1,
      unit_price_amount: "25.00",
      line_total_amount: "25.00",
      modifiers: [],
    },
    {
      id: "item-2",
      product_id: "product-2",
      product_name: "Roll",
      quantity: 1,
      unit_price_amount: "25.00",
      line_total_amount: "25.00",
      modifiers: [],
    },
  ],
  payments: [],
};

const receipt = {
  order_id: "order-1",
  receipt_number: "ABC123",
  tenant_name: "Bakery",
  created_at: "2026-05-08T00:00:00Z",
  status: "completed",
  items: [
    {
      product_name: "Latte",
      quantity: 1,
      unit_price_amount: "58.00",
      line_total_amount: "58.00",
      modifiers: [
        {
          modifier_group_name: "Milk",
          modifier_option_name: "Oat",
          price_delta_amount: "8.00",
        },
      ],
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
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function meResponse(role: string) {
  return {
    authenticated: true,
    user: { id: "user-1", email: "test@bakery.com", tenant_id: "tenant-1", role },
    tenant_id: "tenant-1",
    tenant_name: "Bakery",
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

// URL-pattern → response queue. First-match wins. Each pattern has its own queue
// so the order BillingBanner vs OrderDetail fires their effects does not matter.
function setupFetchMock(routes: Record<string, unknown[]>) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([pattern, list]) => [pattern, [...list]]),
  );
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    for (const [pattern, queue] of Object.entries(queues)) {
      if (url.includes(pattern)) {
        const next = queue.shift();
        if (next === undefined) {
          throw new Error(`Exhausted fetch mocks for ${pattern} (called ${url})`);
        }
        return jsonResponse(next);
      }
    }
    throw new Error(`No fetch mock matched ${url}`);
  });
}

function mockInitialLoad(currentReceipt: unknown = receipt, role = "cashier") {
  return setupFetchMock({
    "/api/v1/auth/session": [meResponse(role)],
    "/api/v1/billing/subscription": [billingAllowedResponse],
    "/api/v1/orders/order-1/receipt": [currentReceipt],
    "/api/v1/orders/order-1": [order],
  });
}

afterEach(() => {
  invalidateBillingSubscription();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.pushState(null, "", "/");
});

describe("OrderDetail", () => {
  it("shows receipt refunds and hides actions without permission", async () => {
    mockInitialLoad({
      ...receipt,
      refunds: [
        {
          id: "refund-1",
          reason: "customer_return",
          refunded_amount: "25.00",
          created_at: "2026-05-08T01:00:00Z",
          items: [
            {
              order_item_id: "item-1",
              quantity: 1,
              unit_price_amount: "25.00",
              line_total_amount: "25.00",
            },
          ],
        },
      ],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /detalle de la orden/i })).toBeInTheDocument();
    expect(screen.getByText(/devoluci[oó]n de cliente/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Devolver" })).not.toBeInTheDocument();
    expect(screen.getByText(/acci[oó]n no disponible/i)).toBeInTheDocument();
    expect(await screen.findByText(/Oat/)).toBeInTheDocument();
  });

  it("submits a refund and reloads the receipt", async () => {
    const refundResponse = {
      id: "refund-1",
      order_id: "order-1",
      reason: "customer_return",
      refunded_amount: "25.00",
      items: [],
      created_at: "2026-05-08T01:00:00Z",
    };
    const reloadedReceipt = {
      ...receipt,
      refunds: [
        {
          id: "refund-1",
          reason: "customer_return",
          refunded_amount: "25.00",
          created_at: "2026-05-08T01:00:00Z",
          items: [],
        },
      ],
    };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [refundResponse],
      "/api/v1/orders/order-1/receipt": [receipt, reloadedReceipt],
      "/api/v1/orders/order-1": [order, order],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Devolver" }));
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /registrar devoluci[oó]n/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orders/order-1/refunds",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/devoluci[oó]n registrada/i)).toBeInTheDocument();
  });

  it("submits a void after confirmation", async () => {
    const voidResponse = {
      id: "void-1",
      order_id: "order-1",
      reason: "operator_error",
      created_at: "2026-05-08T01:00:00Z",
    };
    const voidedOrder = { ...order, status: "voided" };
    const voidedReceipt = {
      ...receipt,
      status: "voided",
      void: { id: "void-1", reason: "operator_error", created_at: "2026-05-08T01:00:00Z" },
    };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/void": [voidResponse],
      "/api/v1/orders/order-1/receipt": [receipt, voidedReceipt],
      "/api/v1/orders/order-1": [order, voidedOrder],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByLabelText(/revierte el inventario/i));
    fireEvent.click(screen.getByRole("button", { name: /cancelar orden/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orders/order-1/void",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/orden cancelada/i)).toBeInTheDocument();
  });

  it("reprints the shared receipt from order detail", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    mockInitialLoad(receipt, "owner");
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText(/Latte/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /imprimir ticket/i }));

    expect(printSpy).toHaveBeenCalledOnce();
  });
});
