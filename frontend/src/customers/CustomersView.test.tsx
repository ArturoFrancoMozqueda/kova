import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CustomersView } from "./CustomersView";
import { customerActivity, customerHistory, getCustomer, listCustomers, saveCustomer } from "./api";

let manage = true;
let historyAccess = true;
let tenantId = "tenant-1";
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: { status: "authenticated", tenantId, user: { id: "user-1", role: "owner" } } }) }));
vi.mock("@/auth/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/auth/permissions", () => ({
  CUSTOMERS_MANAGE_PERMISSION: "customers.manage",
  CUSTOMERS_HISTORY_PERMISSION: "customers.history",
  ORDER_CREATE_PERMISSION: "orders.create",
  CUSTOMER_ORDER_CREATE_PERMISSION: "customer_orders.create",
  usePermission: (permission: string) =>
    permission === "customers.manage" ? manage : permission === "customers.history" ? historyAccess : true,
}));
vi.mock("./api", () => ({
  listCustomers: vi.fn(),
  saveCustomer: vi.fn(),
  customerHistory: vi.fn(),
  getCustomer: vi.fn(),
  customerActivity: vi.fn(),
}));
const customer = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana",
  email: null,
  phone: null,
  is_active: true,
  created_at: "2026-10-06T00:00:00Z",
};
function renderCustomers(entry = "/customers") {
  return render(<MemoryRouter initialEntries={[entry]}><CustomersView /></MemoryRouter>);
}
describe("Clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manage = true;
    historyAccess = true;
    tenantId = "tenant-1";
    vi.mocked(listCustomers).mockResolvedValue([customer]);
    vi.mocked(saveCustomer).mockResolvedValue(customer);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    vi.mocked(customerHistory).mockResolvedValue({ customer, limit: 50, offset: 0, has_more: false, purchases: [] });
    vi.mocked(customerActivity).mockResolvedValue({ branch_id: "branch-1", sections: [] });
  });
  it("exposes the page content landmark and its browser title", () => {
    renderCustomers();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Clientes" }));
    expect(document.title).toBe("Clientes · Kova");
  });
  it("crea un cliente con datos opcionales y recarga la lista", async () => {
    renderCustomers();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: " Ana " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));
    await waitFor(() =>
      expect(saveCustomer).toHaveBeenCalledWith(
        { name: "Ana", email: null, phone: null, is_active: true },
        undefined,
      ),
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
  });
  it("muestra compras y devoluciones reales", async () => {
    vi.mocked(customerHistory).mockResolvedValue({
      customer,
      limit: 50,
      offset: 0,
      has_more: false,
      purchases: [
        {
          id: "sale-12345678",
          branch_id: "branch-1",
          occurred_at: "2026-10-06T00:00:00Z",
          status: "completed",
          total_amount: "20",
          refunded_amount: "5",
        },
      ],
    });
    renderCustomers();
    fireEvent.click(await screen.findByRole("button", { name: "Ver cliente" }));
    expect(await screen.findByText("Compras de Ana")).toBeInTheDocument();
    expect(screen.getByText("Devuelto: $5.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Venta completada/ })).toHaveAttribute("href", "/orders/sale-12345678");
    expect(screen.getByRole("link", { name: "Nueva venta" })).toHaveAttribute("href", `/register?customerId=${customer.id}`);
    expect(screen.getByRole("link", { name: "Agendar cita" })).toHaveAttribute("href", `/appointments?customerId=${customer.id}`);
    expect(screen.getByRole("link", { name: "Nuevo pedido" })).toHaveAttribute("href", `/pedidos/nuevo?customerId=${customer.id}`);
  });
  it("oculta gestión cuando el rol solo puede consultar clientes", async () => {
    manage = false;
    renderCustomers();
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nuevo cliente" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });
  it("abre el cliente exacto desde un enlace aunque no esté en la página de la lista", async () => {
    vi.mocked(listCustomers).mockResolvedValue([]);
    renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByRole("heading", { name: "Ana" })).toBeInTheDocument();
    expect(getCustomer).toHaveBeenCalledWith(customer.id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("muestra actividad real por sucursal con enlaces exactos y alcance limitado", async () => {
    vi.mocked(customerActivity).mockResolvedValue({ branch_id: "branch-1", sections: [
      { source: "appointments", has_more: true, items: [{ id: "appointment-1", title: "Corte de cabello", state: "scheduled", created_at: "2026-10-06T00:00:00Z", due_at: null }] },
      { source: "followups", has_more: false, items: [{ id: "task-1", title: "Revisar entrega", state: "pending", created_at: "2026-10-06T00:00:00Z", due_at: null }] },
      { source: "customer_orders", has_more: false, items: [{ id: "pedido-1", title: "PED-042", state: "ready", created_at: "2026-10-06T00:00:00Z", due_at: null }] },
    ] });
    renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByRole("link", { name: "Corte de cabello" })).toHaveAttribute("href", "/appointments?appointmentId=appointment-1");
    expect(screen.getByRole("link", { name: "Revisar entrega" })).toHaveAttribute("href", "/followups?task_id=task-1");
    expect(screen.getByRole("link", { name: "PED-042" })).toHaveAttribute("href", "/pedidos/pedido-1");
    expect(screen.getByText(/10 más recientes/)).toBeInTheDocument();
  });
  it("permite venta pero no solicita historial ni actividad sin permiso de administración", async () => {
    historyAccess = false;
    manage = false;
    renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByRole("link", { name: "Nueva venta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Agendar cita" })).not.toBeInTheDocument();
    expect(customerHistory).not.toHaveBeenCalled();
    expect(customerActivity).not.toHaveBeenCalled();
  });
  it("conserva el historial de inactivos sin ofrecer venta o cita nueva", async () => {
    vi.mocked(getCustomer).mockResolvedValue({ ...customer, is_active: false });
    renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByText(/Cliente inactivo/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nueva venta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Agendar cita" })).not.toBeInTheDocument();
  });
  it("resume actividad extensa y permite ampliar sin ocultar compras ni acciones", async () => {
    vi.mocked(customerActivity).mockResolvedValue({ branch_id: "branch-1", sections: [{ source: "appointments", has_more: true, items: Array.from({ length: 10 }, (_, index) => ({ id: `appointment-${index}`, title: `Cita ${index + 1}`, state: "scheduled", created_at: "2026-10-06T00:00:00Z", due_at: null })) }] });
    renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByRole("link", { name: "Cita 1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cita 4" })).not.toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "Ver más · Citas" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(screen.getByRole("link", { name: "Cita 10" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar menos · Citas" }));
    expect(screen.queryByRole("link", { name: "Cita 10" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva venta" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compras de Ana" })).toBeInTheDocument();
  });
  it("mantiene acciones e historial si falla actividad y permite reintentar esa lectura", async () => {
    vi.mocked(customerActivity).mockRejectedValueOnce(new Error("network"));
    renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByRole("button", { name: "Reintentar actividad" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva venta" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compras de Ana" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar actividad" }));
    expect(await screen.findByText(/aún no tiene actividad/)).toBeInTheDocument();
    expect(getCustomer).toHaveBeenCalledTimes(1);
  });
  it("oculta compras ya cargadas cuando se revoca el permiso", async () => {
    const view = renderCustomers(`/customers?customerId=${customer.id}`);
    expect(await screen.findByRole("heading", { name: "Compras de Ana" })).toBeInTheDocument();
    historyAccess = false;
    view.rerender(<MemoryRouter><CustomersView /></MemoryRouter>);
    expect(screen.queryByRole("heading", { name: "Compras de Ana" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Actividad del cliente" })).not.toBeInTheDocument();
  });
  it("limpia la ficha y descarta respuestas tardías al cambiar de negocio", async () => {
    let resolveFirst: ((value: typeof customer) => void) | undefined;
    vi.mocked(getCustomer).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const view = renderCustomers(`/customers?customerId=${customer.id}`);
    await waitFor(() => expect(getCustomer).toHaveBeenCalledTimes(1));
    tenantId = "tenant-2";
    vi.mocked(getCustomer).mockRejectedValue(new Error("Cliente no encontrado"));
    view.rerender(<MemoryRouter><CustomersView /></MemoryRouter>);
    expect(await screen.findByText("Cliente no encontrado")).toBeInTheDocument();
    resolveFirst?.(customer);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Ana" })).not.toBeInTheDocument());
    expect(customerHistory).not.toHaveBeenCalled();
  });
});
