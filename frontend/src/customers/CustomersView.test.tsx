import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomersView } from "./CustomersView";
import { customerHistory, listCustomers, saveCustomer } from "./api";

let manage = true;
vi.mock("@/auth/permissions", () => ({
  CUSTOMERS_MANAGE_PERMISSION: "customers.manage",
  CUSTOMERS_HISTORY_PERMISSION: "customers.history",
  usePermission: (permission: string) =>
    permission === "customers.manage" ? manage : true,
}));
vi.mock("./api", () => ({
  listCustomers: vi.fn(),
  saveCustomer: vi.fn(),
  customerHistory: vi.fn(),
}));
const customer = {
  id: "c1",
  name: "Ana",
  email: null,
  phone: null,
  is_active: true,
  created_at: "2026-10-06T00:00:00Z",
};
describe("Clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manage = true;
    vi.mocked(listCustomers).mockResolvedValue([customer]);
    vi.mocked(saveCustomer).mockResolvedValue(customer);
  });
  it("exposes the page content landmark and its browser title", () => {
    render(<CustomersView />);
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Clientes" }));
    expect(document.title).toBe("Clientes · Kova");
  });
  it("crea un cliente con datos opcionales y recarga la lista", async () => {
    render(<CustomersView />);
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
    render(<CustomersView />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver compras" }));
    expect(await screen.findByText("Compras de Ana")).toBeInTheDocument();
    expect(screen.getByText("Devuelto: $5.00")).toBeInTheDocument();
  });
  it("oculta gestión cuando el rol solo puede consultar clientes", async () => {
    manage = false;
    render(<CustomersView />);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nuevo cliente" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar" }),
    ).not.toBeInTheDocument();
  });
});
