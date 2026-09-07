import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "./types";

const api = vi.hoisted(() => ({
  getCustomerOrder: vi.fn(),
  checkoutCustomerOrder: vi.fn(),
  getReceipt: vi.fn(),
  getOpenShift: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getCustomerOrder: (...args: unknown[]) => api.getCustomerOrder(...args),
    checkoutCustomerOrder: (...args: unknown[]) => api.checkoutCustomerOrder(...args),
  };
});
vi.mock("@/orders/api", () => ({ getReceipt: (...args: unknown[]) => api.getReceipt(...args) }));
vi.mock("@/shifts/api", () => ({ getOpenShift: (...args: unknown[]) => api.getOpenShift(...args) }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({
    state: {
      status: "authenticated",
      tenantName: "Sweet Home",
      tenantLogoUrl: null,
    },
  }),
}));

import { CustomerOrderCheckoutRegister } from "./CustomerOrderCheckoutRegister";

const order = {
  id: "customer-order-1",
  tenant_id: "tenant-1",
  folio: "PED-ABC12345",
  status: "ready",
  payment_status: "unpaid",
  fulfillment_type: "pickup",
  source_channel: "counter",
  customer_name: null,
  customer_phone: null,
  delivery_address: null,
  delivery_reference: null,
  promised_at: null,
  note: null,
  subtotal_amount: "50.00",
  total_amount: "50.00",
  sale_order_id: null,
  version: 1,
  stock_conflict: false,
  items: [{
    id: "item-1",
    product_id: "product-1",
    product_name: "Concha",
    quantity: 1,
    unit_price_amount: "50.00",
    line_total_amount: "50.00",
    note: null,
    modifier_option_ids: [],
    modifiers: [],
  }],
  confirmed_at: null,
  ready_at: null,
  fulfilled_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  cancellation_note: null,
  created_at: "2026-08-17T12:00:00Z",
  updated_at: "2026-08-17T12:00:00Z",
} satisfies CustomerOrder;

function renderCheckout() {
  return render(<MemoryRouter><CustomerOrderCheckoutRegister orderId={order.id} /></MemoryRouter>);
}

describe("CustomerOrderCheckoutRegister", () => {
  beforeEach(() => {
    api.getCustomerOrder.mockReset().mockResolvedValue(order);
    api.checkoutCustomerOrder.mockReset();
    api.getReceipt.mockReset();
    api.getOpenShift.mockReset().mockResolvedValue({ id: "shift-1", status: "open" });
  });

  it("blocks cash before submit when there is no open shift", async () => {
    api.getOpenShift.mockResolvedValue(null);
    renderCheckout();

    expect(await screen.findByText(/abre un turno antes de cobrar este pedido/i)).toBeVisible();
    expect(screen.getByRole("radio", { name: "Efectivo" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: "Transferencia" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the successful checkout state when only receipt loading fails", async () => {
    api.checkoutCustomerOrder.mockResolvedValue({
      customer_order: { ...order, payment_status: "paid", sale_order_id: "sale-1", version: 2 },
      sale_order: { id: "sale-1", total_amount: "50.00" },
    });
    api.getReceipt.mockRejectedValue(new Error("receipt unavailable"));
    renderCheckout();

    const cash = await screen.findByLabelText("Efectivo recibido");
    fireEvent.change(cash, { target: { value: "50.00" } });
    const charge = screen.getByRole("button", { name: /cobrar \$50\.00/i });
    await waitFor(() => expect(charge).toBeEnabled());
    fireEvent.click(charge);

    expect(await screen.findByRole("heading", { name: "Pedido cobrado" })).toBeVisible();
    expect(screen.getByText(/el cobro se completó, pero el recibo no pudo cargarse/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /cobrar/i })).not.toBeInTheDocument();
  });

  it("reuses the idempotency key after a lost checkout response", async () => {
    api.checkoutCustomerOrder
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        customer_order: { ...order, payment_status: "paid", sale_order_id: "sale-1", version: 2 },
        sale_order: { id: "sale-1", total_amount: "50.00" },
      });
    api.getReceipt.mockRejectedValue(new Error("receipt unavailable"));
    renderCheckout();

    fireEvent.change(await screen.findByLabelText("Efectivo recibido"), { target: { value: "50.00" } });
    const charge = screen.getByRole("button", { name: /cobrar \$50\.00/i });
    await waitFor(() => expect(charge).toBeEnabled());
    fireEvent.click(charge);
    await screen.findByText("No se pudo cobrar el pedido.");
    await waitFor(() => expect(api.checkoutCustomerOrder).toHaveBeenCalledTimes(1));
    fireEvent.click(charge);
    await waitFor(() => expect(api.checkoutCustomerOrder).toHaveBeenCalledTimes(2));

    expect(api.checkoutCustomerOrder.mock.calls[0][3]).toBe(api.checkoutCustomerOrder.mock.calls[1][3]);
  });
});
