import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/auth/permissions", () => ({ INVENTORY_ADJUST_PERMISSION: "inventory.adjust", usePermission: () => true }));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn() }));
vi.mock("./api", () => ({ listSuppliers: vi.fn(), listPurchases: vi.fn(), createSupplier: vi.fn(), createPurchase: vi.fn(), receivePurchase: vi.fn(), cancelPurchase: vi.fn() }));

import { listProducts } from "@/catalog/api";
import { listPurchases, listSuppliers, receivePurchase } from "./api";
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
