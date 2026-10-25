import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/auth/permissions", () => ({ INVENTORY_ADJUST_PERMISSION: "inventory.adjust", usePermission: () => true }));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn() }));
vi.mock("./api", () => ({ listSuppliers: vi.fn(), listPurchases: vi.fn(), createSupplier: vi.fn(), createPurchase: vi.fn(), receivePurchase: vi.fn(), cancelPurchase: vi.fn() }));

import { listProducts } from "@/catalog/api";
import { listPurchases, listSuppliers, receivePurchase, type Supplier } from "./api";
import type { Product } from "@/catalog/types";
import PurchasingView from "./PurchasingView";

const mount = (path = "/purchasing") => render(<MemoryRouter initialEntries={[path]}><PurchasingView /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.mocked(listProducts).mockResolvedValue([]);
  vi.mocked(listSuppliers).mockResolvedValue([]);
  vi.mocked(listPurchases).mockResolvedValue([{ id: "purchase-1", branch_id: "branch-1", supplier_id: "supplier-1", supplier_name: "Molino", notes: null, status: "partial", created_at: "2026-10-05T12:00:00Z", items: [{ id: "item-1", product_id: "product-1", product_name: "Harina", quantity: 10, received_quantity: 3, unit_cost: "4.50" }] }]);
});

it("receives only entered pending units and leaves cost unchanged by default", async () => {
  vi.mocked(receivePurchase).mockResolvedValue({} as Awaited<ReturnType<typeof receivePurchase>>);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Recibir mercancía" }));
  const quantity = screen.getByLabelText("Harina · pendientes 7");
  expect(quantity).toHaveAttribute("max", "7");
  fireEvent.change(quantity, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }));
  await waitFor(() => expect(receivePurchase).toHaveBeenCalledWith("purchase-1", [{ item_id: "item-1", quantity: 2 }], false, expect.any(String)));
});

it("blocks purchasing while offline", async () => {
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  mount();
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
  mount();

  expect(screen.getByText("Cargando compras…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo proveedor" }));
  expect(screen.getByText("Cargando proveedores…")).toBeInTheDocument();
  expect(screen.queryByText("Agrega tu primer proveedor para preparar una compra.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preparar compra" }));
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
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo proveedor" }));

  expect(screen.queryByText("Agrega tu primer proveedor para preparar una compra.")).not.toBeInTheDocument();
  await act(async () => { resolveSuppliers([]); });
  expect(screen.getByText("Agrega tu primer proveedor para preparar una compra.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preparar compra" }));
  expect(screen.getByText("Activa el control de inventario de tus productos en Catálogo para comprarlos.")).toBeInTheDocument();
  expect(screen.getByText("No hay compras en esta página.")).toBeInTheDocument();
});

it("keeps a load failure distinct from empty results and clears it after a successful retry", async () => {
  vi.mocked(listSuppliers).mockRejectedValueOnce(new Error("No pudimos consultar proveedores."));
  vi.mocked(listPurchases).mockResolvedValue([]);
  mount();

  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos consultar proveedores.");
  expect(screen.queryByText("Agrega tu primer proveedor para preparar una compra.")).not.toBeInTheDocument();
  expect(screen.queryByText("Activa el control de inventario de tus productos en Catálogo para comprarlos.")).not.toBeInTheDocument();
  expect(screen.queryByText("No hay compras en esta página.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Nuevo proveedor" }));
  expect(screen.getByText("Agrega tu primer proveedor para preparar una compra.")).toBeInTheDocument();
});

it("prioritizes existing purchases and opens setup only from the header actions", async () => {
  mount();
  const record = await screen.findByRole("region", { name: "Compra purchase" });
  const prepare = screen.getByRole("button", { name: "Preparar compra" });
  const supplier = screen.getByRole("button", { name: "Nuevo proveedor" });
  expect(prepare).toHaveAttribute("aria-expanded", "false");
  expect(supplier).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Crear compra pendiente" })).not.toBeInTheDocument();

  fireEvent.click(prepare);
  const form = screen.getByRole("region", { name: "Preparar compra pendiente" });
  expect(prepare).toHaveAttribute("aria-expanded", "true");
  expect(prepare).toHaveAttribute("aria-controls", form.id);
  expect(form).toHaveFocus();
  expect(record.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: "Crear compra pendiente" })).toBeDisabled();
  expect(receivePurchase).not.toHaveBeenCalled();
});

it("preserves supplier and purchase drafts when folding or switching setup panels", async () => {
  mount();
  await screen.findByRole("region", { name: "Compra purchase" });
  const supplier = screen.getByRole("button", { name: "Nuevo proveedor" });
  const purchase = screen.getByRole("button", { name: "Preparar compra" });
  fireEvent.click(supplier);
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Proveedor del borrador" } });
  fireEvent.change(screen.getByLabelText("Teléfono o correo (opcional)"), { target: { value: "contacto@example.com" } });
  fireEvent.click(purchase);
  fireEvent.change(screen.getByLabelText("Unidades"), { target: { value: "8" } });
  fireEvent.change(screen.getByLabelText("Costo unitario MXN"), { target: { value: "25.50" } });
  fireEvent.change(screen.getByLabelText("Referencia o notas (opcional)"), { target: { value: "Compra pendiente de revisar" } });
  fireEvent.click(purchase);
  expect(screen.queryByRole("region", { name: "Preparar compra pendiente" })).not.toBeInTheDocument();
  fireEvent.click(supplier);
  expect(screen.getByLabelText("Nombre")).toHaveValue("Proveedor del borrador");
  expect(screen.getByLabelText("Teléfono o correo (opcional)")).toHaveValue("contacto@example.com");
  fireEvent.click(purchase);
  expect(screen.getByLabelText("Unidades")).toHaveValue(8);
  expect(screen.getByLabelText("Costo unitario MXN")).toHaveValue(25.5);
  expect(screen.getByLabelText("Referencia o notas (opcional)")).toHaveValue("Compra pendiente de revisar");
});

it("opens the exact purchase from replenishment without receiving anything, including on a fresh mount", async () => {
  const view = mount("/purchasing?purchase_id=purchase-1");
  const record = await screen.findByRole("region", { name: "Compra purchase" });
  await waitFor(() => expect(record).toHaveFocus());
  expect(screen.getByRole("status")).toHaveTextContent("Estás revisando la compra del enlace");
  expect(screen.queryByRole("button", { name: "Confirmar recepción" })).not.toBeInTheDocument();
  expect(receivePurchase).not.toHaveBeenCalled();
  view.unmount();

  mount("/purchasing?purchase_id=purchase-1");
  await waitFor(() => expect(screen.getByRole("region", { name: "Compra purchase" })).toHaveFocus());
  expect(receivePurchase).not.toHaveBeenCalled();
});

it("does not substitute another purchase when the link is outside the loaded page or branch", async () => {
  mount("/purchasing?purchase_id=another-purchase");
  await screen.findByText(/La compra del enlace no aparece en esta página/);
  expect(screen.getByRole("region", { name: "Compra purchase" })).not.toHaveFocus();
  expect(screen.queryByRole("button", { name: "Confirmar recepción" })).not.toBeInTheDocument();
  expect(receivePurchase).not.toHaveBeenCalled();
});
