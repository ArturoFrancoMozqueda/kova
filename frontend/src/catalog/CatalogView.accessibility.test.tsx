import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
import CatalogView from "./CatalogView";
import type { Product } from "./types";

vi.mock("../auth/permissions", () => ({
  CATALOG_CREATE_PERMISSION: "catalog.create",
  CATALOG_UPDATE_PERMISSION: "catalog.update",
  CATALOG_DELETE_PERMISSION: "catalog.delete",
  usePermission: () => true,
}));
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  listCategories: vi.fn(async () => []),
  listModifierGroups: vi.fn(async () => []),
  listProducts: vi.fn(async (): Promise<Product[]> => [{
    id: "product-1", tenant_id: "tenant-1", category_id: null, name: "Café",
    description: null, sku: "CAF-1", price_amount: "10.00", cost_price: "3.00",
    track_inventory: true, low_stock_threshold: 2, image_url: null,
    image_position_x: 50, image_position_y: 50, image_zoom: 1,
    is_active: true, modifier_groups: [],
  }]),
}));

it("keeps catalog sections at level two before product headings", async () => {
  const { container } = render(<MemoryRouter><ToastProvider><CatalogView /></ToastProvider></MemoryRouter>);
  await screen.findByText("Café", { exact: true });
  for (const section of [copy.catalog.categories, copy.catalog.products, copy.catalog.modifiers]) {
    expect(screen.getByRole("heading", { name: section, level: 2 })).toBeInTheDocument();
  }
  expect((await axe(container, { runOnly: ["heading-order"] })).violations).toEqual([]);
});
