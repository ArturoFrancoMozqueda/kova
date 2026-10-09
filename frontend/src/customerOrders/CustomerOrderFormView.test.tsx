import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/catalog/types";
import type { CustomerOrder } from "./types";

const api = vi.hoisted(() => ({
  listProducts: vi.fn(), listStock: vi.fn(), getCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(), updateCustomerOrder: vi.fn(), confirmCustomerOrder: vi.fn(),
  navigate: vi.fn(), route: { orderId: undefined as string | undefined },
}));
vi.mock("react-router-dom", async original => ({ ...await original<object>(), useNavigate: () => api.navigate, useParams: () => api.route }));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/catalog/api", () => ({ listProducts: (...args: unknown[]) => api.listProducts(...args) }));
vi.mock("@/inventory/api", () => ({ listStock: (...args: unknown[]) => api.listStock(...args) }));
vi.mock("./api", () => ({
  getCustomerOrder: (...args: unknown[]) => api.getCustomerOrder(...args),
  createCustomerOrder: (...args: unknown[]) => api.createCustomerOrder(...args),
  updateCustomerOrder: (...args: unknown[]) => api.updateCustomerOrder(...args),
  confirmCustomerOrder: (...args: unknown[]) => api.confirmCustomerOrder(...args),
}));

import CustomerOrderFormView from "./CustomerOrderFormView";

const product: Product = {
  id: "product-1", tenant_id: "tenant", category_id: null, name: "Concha", description: null,
  sku: null, price_amount: "10.00", track_inventory: false, low_stock_threshold: null,
  image_url: null, image_position_x: 50, image_position_y: 50, image_zoom: 1,
  is_active: true, modifier_groups: [],
};
const saved: CustomerOrder = {
  id: "order-1", tenant_id: "tenant", folio: "PED-FIRST", status: "new", payment_status: "unpaid",
  fulfillment_type: "pickup", source_channel: "counter", customer_name: null, customer_phone: null,
  delivery_address: null, delivery_reference: null, promised_at: null, note: null,
  subtotal_amount: "10.00", total_amount: "10.00", sale_order_id: null, version: 1, stock_conflict: false,
  items: [{ id: "item-1", product_id: product.id, product_name: product.name, quantity: 1,
    unit_price_amount: "10.00", line_total_amount: "10.00", note: null, modifier_option_ids: [], modifiers: [] }],
  confirmed_at: null, ready_at: null, fulfilled_at: null, cancelled_at: null,
  cancellation_reason: null, cancellation_note: null,
  created_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.route.orderId = undefined;
  api.listProducts.mockResolvedValue([product]);
  api.listStock.mockResolvedValue([]);
  api.getCustomerOrder.mockResolvedValue(saved);
  api.createCustomerOrder.mockReset().mockResolvedValue(saved);
  api.updateCustomerOrder.mockReset().mockResolvedValue(saved);
  api.confirmCustomerOrder.mockReset().mockResolvedValue({ ...saved, status: "confirmed", version: 2 });
});

describe("customer order draft safety", () => {
  it("names every pickup and delivery field and identifies each line's quantity controls", async () => {
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar Concha" }));
    expect(screen.getByRole("textbox", { name: "Buscar producto o SKU" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Canal" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Nombre" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Teléfono" })).toBeVisible();
    expect(screen.getByLabelText("Prometido para")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Nota general" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Nota de Concha (opcional)" })).toBeVisible();
    for (const name of ["Quitar una unidad", "Agregar una unidad", "Eliminar artículo"]) {
      expect(screen.getByRole("button", { name })).toHaveAccessibleDescription("Concha");
    }
    fireEvent.change(screen.getByRole("combobox", { name: "Modalidad" }), { target: { value: "delivery" } });
    expect(screen.getByRole("textbox", { name: "Dirección" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Referencia" })).toBeVisible();
  });

  it("groups repeat selections of the same new product and modifiers", async () => {
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    const add = await screen.findByRole("button", { name: "Agregar Concha" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getAllByRole("button", { name: "Eliminar artículo" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.createCustomerOrder).toHaveBeenCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ product_id: product.id, quantity: 2 })] }),
      expect.any(String),
    ));
  });

  it("reuses the creation and confirmation identities after a lost confirmation response", async () => {
    api.confirmCustomerOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar Concha" }));
    const confirm = screen.getByRole("button", { name: "Guardar y confirmar" });
    fireEvent.click(confirm);
    await screen.findByRole("alert");
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(api.confirmCustomerOrder).toHaveBeenCalledTimes(2));
    expect(api.createCustomerOrder.mock.calls[0][1]).toEqual(expect.any(String));
    expect(api.createCustomerOrder.mock.calls[1][1]).toBe(api.createCustomerOrder.mock.calls[0][1]);
    expect(api.confirmCustomerOrder.mock.calls[0][2]).toEqual(expect.any(String));
    expect(api.confirmCustomerOrder.mock.calls[1][2]).toBe(api.confirmCustomerOrder.mock.calls[0][2]);
  });

  it("starts an empty draft when navigating from an edit form to a new order", async () => {
    api.route.orderId = saved.id;
    const view = render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Editar PED-FIRST" });
    api.route.orderId = undefined;
    view.rerender(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Nuevo pedido" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Eliminar artículo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agrega al menos un producto.");
    expect(api.updateCustomerOrder).not.toHaveBeenCalled();
  });

  it.each([
    { status: "new" as const, quantities: [2], available: 3, onHand: 3, reserved: 0, expected: 3 },
    { status: "confirmed" as const, quantities: [1, 2], available: 1, onHand: 4, reserved: 3, expected: 4 },
    { status: "confirmed" as const, quantities: [2], available: 0, onHand: 1, reserved: 3, expected: 0 },
  ])("shows actual availability including only this $status order's active reservations", async ({ status, quantities, available, onHand, reserved, expected }) => {
    api.route.orderId = saved.id;
    api.listProducts.mockResolvedValue([{ ...product, track_inventory: true }]);
    api.listStock.mockResolvedValue([{ product_id: product.id, available_quantity: available, stock_on_hand: onHand, reserved_quantity: reserved }]);
    api.getCustomerOrder.mockResolvedValue({
      ...saved, status,
      items: quantities.map((quantity, index) => ({ ...saved.items[0], id: `item-${index}`, quantity })),
    });
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Editar PED-FIRST" });
    expect(screen.getByText(`${expected} disp.`)).toBeVisible();
  });
});
