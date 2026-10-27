import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/catalog/types";
import type { CustomerOrder } from "./types";

const api = vi.hoisted(() => ({
  listProducts: vi.fn(), listStock: vi.fn(), getCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(), updateCustomerOrder: vi.fn(), confirmCustomerOrder: vi.fn(),
  navigate: vi.fn(), route: { orderId: undefined as string | undefined },
  listCustomers: vi.fn(), resolveActiveCustomer: vi.fn(),
}));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated", tenantId: "tenant", user: { id: "user-1", role: "owner" } } }) }));
vi.mock("@/customers/api", () => ({ listCustomers: (...args: unknown[]) => api.listCustomers(...args), resolveActiveCustomer: (...args: unknown[]) => api.resolveActiveCustomer(...args) }));
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
  api.listCustomers.mockResolvedValue([]);
  api.resolveActiveCustomer.mockReset();
  api.listProducts.mockResolvedValue([product]);
  api.listStock.mockResolvedValue([]);
  api.getCustomerOrder.mockResolvedValue(saved);
  api.createCustomerOrder.mockReset().mockResolvedValue(saved);
  api.updateCustomerOrder.mockReset().mockResolvedValue(saved);
  api.confirmCustomerOrder.mockReset().mockResolvedValue({ ...saved, status: "confirmed", version: 2 });
});

describe("customer order draft safety", () => {
  const customer = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", phone: "5512345678", email: null, is_active: true, created_at: "2026-10-22T00:00:00Z" };
  it("continúa desde un cliente exacto y asocia el pedido sin volver a capturar su contacto", async () => {
    api.resolveActiveCustomer.mockResolvedValue(customer);
    render(<MemoryRouter initialEntries={[`/pedidos/nuevo?customerId=${customer.id}`]}><CustomerOrderFormView /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar Concha" }));
    expect(screen.getByRole("textbox", { name: "Nombre" })).toHaveValue("Ana");
    expect(screen.getByRole("textbox", { name: "Teléfono" })).toHaveValue("5512345678");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y cobrar" }));
    await waitFor(() => expect(api.createCustomerOrder).toHaveBeenCalledWith(expect.objectContaining({ customer_id: customer.id, customer_name: "Ana", customer_phone: "5512345678" }), expect.any(String)));
    expect(api.navigate).toHaveBeenCalledWith(`/register?customerOrderId=${saved.id}`);
  });
  it("permite elegir un cliente registrado al crear desde Pedidos", async () => {
    api.listCustomers.mockResolvedValue([customer]);
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Asociar cliente registrado (opcional)"));
    // The native disclosure exposes its fields after the toggle event.
    const details = screen.getByText("Asociar cliente registrado (opcional)").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await screen.findByRole("option", { name: "Ana" });
    fireEvent.change(screen.getByLabelText("Cliente registrado"), { target: { value: customer.id } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Concha" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.createCustomerOrder).toHaveBeenCalledWith(expect.objectContaining({ customer_id: customer.id }), expect.any(String)));
  });
  it("bloquea el pedido si el cliente del enlace no está disponible hasta elegir continuar sin asociación", async () => {
    api.resolveActiveCustomer.mockRejectedValue(new Error("Cliente no encontrado"));
    render(<MemoryRouter initialEntries={[`/pedidos/nuevo?customerId=${customer.id}`]}><CustomerOrderFormView /></MemoryRouter>);
    expect(await screen.findByText("Cliente no encontrado")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agregar Concha" }));
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Continuar sin cliente registrado" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.createCustomerOrder).toHaveBeenCalledWith(expect.objectContaining({ customer_id: null }), expect.any(String)));
  });
  it("preserva la identidad de un pedido existente al editar sin permitir cambiarla por URL", async () => {
    api.route.orderId = saved.id;
    api.getCustomerOrder.mockResolvedValue({ ...saved, customer_id: customer.id, customer_name: customer.name });
    render(<MemoryRouter initialEntries={[`/pedidos/${saved.id}/editar?customerId=otro-cliente`]}><CustomerOrderFormView /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Ana" })).toHaveAttribute("href", `/customers?customerId=${customer.id}`);
    expect(screen.queryByLabelText("Cliente registrado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateCustomerOrder).toHaveBeenCalled());
    expect(api.updateCustomerOrder.mock.calls[0][1]).not.toHaveProperty("customer_id");
    expect(api.resolveActiveCustomer).not.toHaveBeenCalled();
  });
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

  it("distinguishes unknown stock from sold out and retries without losing the draft", async () => {
    const tracked = { ...product, id: "tracked", name: "Pan de nuez", track_inventory: true };
    api.listProducts.mockResolvedValue([product, tracked]);
    api.listStock.mockRejectedValueOnce(new Error("Sin conexión")).mockResolvedValueOnce([
      { product_id: tracked.id, available_quantity: 3, stock_on_hand: 3, reserved_quantity: 0 },
    ]);
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar las existencias");
    expect(screen.getByRole("button", { name: "Agregar Pan de nuez" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Por consultar")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agregar Concha" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nota general" }), { target: { value: "Recoger a las cinco" } });
    fireEvent.click(screen.getByRole("button", { name: "Volver a consultar existencias" }));
    await screen.findByText("3 disp.");
    expect(screen.queryByText("No pudimos consultar las existencias.")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nota general" })).toHaveValue("Recoger a las cinco");
    expect(screen.getAllByRole("button", { name: "Eliminar artículo" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Agregar Pan de nuez" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.createCustomerOrder).toHaveBeenCalledWith(expect.objectContaining({
      note: "Recoger a las cinco", items: [expect.objectContaining({ product_id: product.id }), expect.objectContaining({ product_id: tracked.id })],
    }), expect.any(String)));
    expect(api.listProducts).toHaveBeenCalledTimes(1);
  });

  it("preserves own reservations when retrying stock for an existing order", async () => {
    api.route.orderId = saved.id;
    api.listProducts.mockResolvedValue([{ ...product, track_inventory: true }]);
    api.getCustomerOrder.mockResolvedValue({ ...saved, status: "confirmed", items: [{ ...saved.items[0], quantity: 2 }] });
    api.listStock.mockRejectedValueOnce(new Error("No disponible")).mockResolvedValueOnce([
      { product_id: product.id, available_quantity: 1, stock_on_hand: 4, reserved_quantity: 3 },
    ]);
    render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Volver a consultar existencias" }));
    expect(await screen.findByText("3 disp.")).toBeVisible();
    expect(api.getCustomerOrder).toHaveBeenCalledTimes(1);
    expect(api.updateCustomerOrder).not.toHaveBeenCalled();
  });
});

it("no muestra diagnósticos de la respuesta al guardar y conserva el borrador para reintentar", async () => {
  api.createCustomerOrder.mockRejectedValueOnce({ status: 400, detail: { detail: { message: "UPDATE customer_orders SET tenant_id='interno'" } } });
  render(<MemoryRouter><CustomerOrderFormView /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Agregar Concha" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar el pedido. Revisa los datos e intenta de nuevo.");
  expect(screen.getByRole("alert")).not.toHaveTextContent(/UPDATE|tenant_id/);
  expect(screen.getByRole("button", { name: "Eliminar artículo" })).toBeVisible();
  expect(api.navigate).not.toHaveBeenCalled();
});
