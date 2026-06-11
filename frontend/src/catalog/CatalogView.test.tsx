import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./CatalogView";
import type { Product } from "./types";
import { ToastProvider } from "@/components/ui/toast";

const product: Product = {
  id: "product-1",
  tenant_id: "tenant-1",
  category_id: null,
  name: "Alfajores",
  description: null,
  sku: "PAN-ALF-001",
  price_amount: "32.00",
  track_inventory: true,
  low_stock_threshold: 8,
  image_url: "/api/v1/catalog/products/product-1/image?v=1",
  image_position_x: 50,
  image_position_y: 50,
  is_active: true,
  modifier_groups: [],
};

describe("ProductForm image positioning", () => {
  it("updates the preview object position and submits the saved focus", async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <ToastProvider>
        <ProductForm
          initial={product}
          categories={[]}
          availableModifierGroups={[]}
          defaultCategoryId={null}
          pending={false}
          onCancel={vi.fn()}
          onSubmit={onSubmit}
        />
      </ToastProvider>,
    );

    const preview = screen.getByTestId("product-image-preview");
    expect(preview).toHaveStyle({ objectPosition: "50% 50%" });

    fireEvent.change(screen.getByLabelText("Ajuste horizontal"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("Ajuste vertical"), {
      target: { value: "70" },
    });

    expect(preview).toHaveStyle({ objectPosition: "35% 70%" });

    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        image_position_x: 35,
        image_position_y: 70,
      }),
    );
  });

  it("can reset image focus back to center", () => {
    render(
      <ToastProvider>
        <ProductForm
          initial={{ ...product, image_position_x: 20, image_position_y: 80 }}
          categories={[]}
          availableModifierGroups={[]}
          defaultCategoryId={null}
          pending={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Centrar" }));

    expect(screen.getByTestId("product-image-preview")).toHaveStyle({
      objectPosition: "50% 50%",
    });
  });
});
