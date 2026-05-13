import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

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

function mockInitialLoad(currentReceipt: unknown = receipt, role = "cashier") {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(jsonResponse(meResponse(role)))
    .mockResolvedValueOnce(jsonResponse(order))
    .mockResolvedValueOnce(jsonResponse(currentReceipt));
}

afterEach(() => {
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

    expect(await screen.findByRole("heading", { name: /order detail/i })).toBeInTheDocument();
    expect(screen.getByText(/customer return/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund" })).not.toBeInTheDocument();
    expect(screen.getByText(/action unavailable/i)).toBeInTheDocument();
    expect(await screen.findByText(/Oat/)).toBeInTheDocument();
  });

  it("submits a refund and reloads the receipt", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(meResponse("owner")))
      .mockResolvedValueOnce(jsonResponse(order))
      .mockResolvedValueOnce(jsonResponse(receipt))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "refund-1",
          order_id: "order-1",
          reason: "customer_return",
          refunded_amount: "25.00",
          items: [],
          created_at: "2026-05-08T01:00:00Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(order))
      .mockResolvedValueOnce(
        jsonResponse({
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
        }),
      );
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Refund" }));
    fireEvent.change(screen.getByLabelText("Concha Quantity"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /record refund/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orders/order-1/refunds",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/refund recorded/i)).toBeInTheDocument();
  });

  it("submits a void after confirmation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(meResponse("owner")))
      .mockResolvedValueOnce(jsonResponse(order))
      .mockResolvedValueOnce(jsonResponse(receipt))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "void-1",
          order_id: "order-1",
          reason: "operator_error",
          created_at: "2026-05-08T01:00:00Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...order, status: "voided" }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...receipt,
          status: "voided",
          void: {
            id: "void-1",
            reason: "operator_error",
            created_at: "2026-05-08T01:00:00Z",
          },
        }),
      );
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    fireEvent.click(screen.getByLabelText(/reverses the order inventory/i));
    fireEvent.click(screen.getByRole("button", { name: /void order/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orders/order-1/void",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/order voided/i)).toBeInTheDocument();
  });
});
