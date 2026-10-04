import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeStory } from "../__fixtures__/story";
import type { StockItem } from "../../inventory/types";
import { ProductTableSection, ProductsPanel } from "./ProductInventoryAnalysis";

const trackedLowStock: StockItem = {
  product_id: "p1",
  product_name: "Latte mediano",
  sku: null,
  track_inventory: true,
  stock_on_hand: 3,
  reserved_quantity: 0,
  available_quantity: 3,
  low_stock_threshold: 10,
  is_low_stock: true,
};

describe("ProductTableSection", () => {
  it("distinguishes untracked products from zero stock", () => {
    const story = makeStory({
      product_drivers: [
        { product_id: "p1", product_name: "Latte mediano", quantity_sold: 40, gross_sales: "4000", sales_share_pct: 40 },
        { product_id: "p2", product_name: "Galleta sin inventario", quantity_sold: 10, gross_sales: "500", sales_share_pct: 5 },
      ],
    });
    // Only p1 is tracked; p2 is absent from listStock() → "Sin vincular", never 0.
    render(<ProductTableSection story={story} stock={[trackedLowStock]} velocity={[]} />);

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Galleta sin inventario");
    expect(screen.getAllByText("Sin vincular").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reabastecer").length).toBeGreaterThan(0);
  });

  it("renders nothing when there are no product drivers", () => {
    const story = makeStory({ product_drivers: [] });
    const { container } = render(<ProductTableSection story={story} stock={[]} velocity={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves sales while avoiding stock and untracked claims after an inventory failure", () => {
    const story = makeStory({ product_drivers: [{
      product_id: "p1", product_name: "Latte mediano", quantity_sold: 40,
      gross_sales: "4000", sales_share_pct: 40,
    }] });
    render(<ProductTableSection story={story} stock={[]} velocity={[]} inventoryAvailable={false} />);
    expect(screen.getByRole("table")).toHaveTextContent("$4,000.00");
    expect(screen.getByRole("table")).toHaveTextContent("Inventario no disponible");
    expect(screen.queryByText("Sin vincular")).not.toBeInTheDocument();
    expect(screen.queryByText("Reabastecer")).not.toBeInTheDocument();
  });
});

describe("ProductsPanel", () => {
  it("leads with the top product answered in exact figures", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const story = makeStory({
      product_drivers: [
        { product_id: "p1", product_name: "Latte mediano", quantity_sold: 40, gross_sales: "4000", sales_share_pct: 40 },
        { product_id: "p2", product_name: "Concha", quantity_sold: 12, gross_sales: "300", sales_share_pct: 8 },
      ],
    });
    render(<ProductsPanel story={story} stock={[trackedLowStock]} velocity={[]} />);

    // "Respuesta primero": the #1 driver with amount + share as the highlight.
    expect(screen.getByText("Latte mediano · $4,000.00 (40% de la venta)")).toBeInTheDocument();
    // The bento cell links to the full table for the rest of the detail.
    expect(screen.getByRole("button", { name: /Ver tabla completa/ })).toBeInTheDocument();
    expect(
      errorSpy.mock.calls.some((call) =>
        call.some((value) => String(value).includes("validateDOMNesting")),
      ),
    ).toBe(false);
    errorSpy.mockRestore();
  });

  it("shows the empty state when there are no product drivers", () => {
    const story = makeStory({ product_drivers: [] });
    render(<ProductsPanel story={story} stock={[]} velocity={[]} />);
    expect(screen.getByText(/Sin ventas de productos/i)).toBeInTheDocument();
  });
});
