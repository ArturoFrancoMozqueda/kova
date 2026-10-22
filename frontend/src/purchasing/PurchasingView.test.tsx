import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/auth/permissions", () => ({ INVENTORY_ADJUST_PERMISSION: "inventory.adjust", usePermission: () => true }));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn() }));
vi.mock("./api", () => ({ listSuppliers: vi.fn(), listPurchases: vi.fn(), createSupplier: vi.fn(), createPurchase: vi.fn(), receivePurchase: vi.fn(), cancelPurchase: vi.fn() }));

import { listProducts } from "@/catalog/api";
import { listPurchases, listSuppliers, receivePurchase, type Supplier } from "./api";
import type { Product } from "@/catalog/types";
import PurchasingView from "./PurchasingView";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.mocked(listProducts).mockResolvedValue([]);
  vi.mocked(listSuppliers).mockResolvedValue([]);
  vi.mocked(listPurchases).mockResolvedValue([{ id: "purchase-1", branch_id: "branch-1", supplier_id: "supplier-1", supplier_name: "Molino", notes: null, status: "partial", created_at: "2026-10-05T12:00:00Z", items: [{ id: "item-1", product_id: "product-1", product_name: "Harina", quantity: 10, received_quantity: 3, unit_cost: "4.50" }] }]);
});

it("receives only entered pending units and leaves cost unchanged by default", async () => {
  vi.mocked(receivePurchase).mockResolvedValue({} as Awaited<ReturnType<typeof receivePurchase>>);
  render(<PurchasingView />);
  fireEvent.click(await screen.findByRole("button", { name: "Recibir mercancía" }));
  const quantity = screen.getByLabelText("Harina · pendientes 7");
  expect(quantity).toHaveAttribute("max", "7");
  fireEvent.change(quantity, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }));
  await waitFor(() => expect(receivePurchase).toHaveBeenCalledWith("purchase-1", [{ item_id: "item-1", quantity: 2 }], false, expect.any(String)));
});

it("blocks purchasing while offline", async () => {
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  render(<PurchasingView />);
  expect(await screen.findByRole("button", { name: "Recibir mercancía" })).toBeDisabled();
  expect(screen.getByText("Conéctate a internet para crear compras y recibir mercancía.")).toBeVisible();
  expect(receivePurchase).not.toHaveBeenCalled();
});

it("does not show setup empty states while the first purchasing load is pending", async () => {
  let resolveSuppliers!: (rows: Supplier[]) => void;
  vi.mocked(listSuppliers).mockReturnValue(new Promise<Supplier[]>(resolve => { resolveSuppliers = resolve; }));
  vi.mocked(listProducts).mockResolvedValue([{
    id: "product-1", tenant_id: "tenant-1", category_id: null, name: "Harina",
    description: null, sku: null, price_amount: "10.00", track_inventory: true,
    low_stock_threshold: 2, image_url: null, image_position_x: 50, image_position_y: 50,
    image_zoom: 1, is_active: true, modifier_groups: [],
  } satisfies Product]);
  render(<PurchasingView />);

  expect(screen.getByText("Cargando compras…")).toBeInTheDocument();
  expect(screen.getByText("Cargando proveedores…")).toBeInTheDocument();
  expect(screen.getByText("Cargando productos con inventario…")).toBeInTheDocument();
  expect(screen.queryByText("Agrega tu primer proveedor para preparar una compra.")).not.toBeInTheDocument();
  expect(screen.queryByText("Activa el control de inventario de tus productos en Catálogo para comprarlos.")).not.toBeInTheDocument();
  expect(screen.queryByText("No hay compras en esta página.")).not.toBeInTheDocument();

  await act(async () => { resolveSuppliers([{ id: "supplier-1", name: "Molino", contact: null, is_active: true }]); });
  expect(screen.queryByText("Cargando compras…")).not.toBeInTheDocument();
  expect(screen.queryByText("Cargando proveedores…")).not.toBeInTheDocument();
  expect(screen.queryByText("Cargando productos con inventario…")).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Molino" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Harina" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recibir mercancía" })).toBeInTheDocument();
});

it("shows setup empty states only after the requests successfully return empty results", async () => {
  let resolveSuppliers!: (rows: Supplier[]) => void;
  vi.mocked(listSuppliers).mockReturnValue(new Promise<Supplier[]>(resolve => { resolveSuppliers = resolve; }));
  vi.mocked(listPurchases).mockResolvedValue([]);
  render(<PurchasingView />);

  expect(screen.queryByText("Agrega tu primer proveedor para preparar una compra.")).not.toBeInTheDocument();
  await act(async () => { resolveSuppliers([]); });
  expect(screen.getByText("Agrega tu primer proveedor para preparar una compra.")).toBeInTheDocument();
  expect(screen.getByText("Activa el control de inventario de tus productos en Catálogo para comprarlos.")).toBeInTheDocument();
  expect(screen.getByText("No hay compras en esta página.")).toBeInTheDocument();
});

it("keeps a load failure distinct from empty results and clears it after a successful retry", async () => {
  vi.mocked(listSuppliers).mockRejectedValueOnce(new Error("No pudimos consultar proveedores."));
  vi.mocked(listPurchases).mockResolvedValue([]);
  render(<PurchasingView />);

  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar proveedores.");
  expect(screen.queryByText("Agrega tu primer proveedor para preparar una compra.")).not.toBeInTheDocument();
  expect(screen.queryByText("Activa el control de inventario de tus productos en Catálogo para comprarlos.")).not.toBeInTheDocument();
  expect(screen.queryByText("No hay compras en esta página.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByText("Agrega tu primer proveedor para preparar una compra.")).toBeInTheDocument();
});
