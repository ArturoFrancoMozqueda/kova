import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./CatalogView";
import type { Product } from "./types";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("@/lib/compressImage", () => ({
  compressImage: vi.fn(async (file: File) => file),
}));

function getPreviewImage(): HTMLImageElement {
  const editor = screen.getByRole("img", { name: /editor de encuadre/i });
  const image = editor.querySelector("img");
  if (!(image instanceof HTMLImageElement)) {
    throw new Error("Expected the image editor to render a preview image.");
  }
  return image;
}

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
  image_zoom: 1.0,
  is_active: true,
  modifier_groups: [],
};

describe("ProductForm image positioning", () => {
  it("renders a selected image preview and submits its framing", async () => {
    const onSubmit = vi.fn(async () => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const objectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:product-preview");
    const file = new File(["image"], "concha.webp", { type: "image/webp" });

    const { container } = render(
      <ToastProvider>
        <ProductForm
          categories={[]}
          availableModifierGroups={[]}
          defaultCategoryId={null}
          pending={false}
          onCancel={vi.fn()}
          onSubmit={onSubmit}
        />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByLabelText("Nombre del producto"), {
      target: { value: "Concha" },
    });
    fireEvent.change(screen.getByLabelText("Precio"), {
      target: { value: "18.00" },
    });

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(getPreviewImage()).toHaveAttribute("src", "blob:product-preview");
    });

    fireEvent.click(screen.getByRole("button", { name: /aumentar zoom/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        image_file: file,
        image_position_x: 50,
        image_position_y: 50,
        image_zoom: 1.1,
      }),
    );

    objectUrlSpy.mockRestore();
  });

  it("updates the preview zoom and submits the saved framing", async () => {
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

    const preview = getPreviewImage();
    expect(preview).toHaveStyle({ objectPosition: "50% 50%" });

    fireEvent.click(screen.getByRole("button", { name: /aumentar zoom/i }));

    expect(preview).toHaveStyle({
      objectPosition: "50% 50%",
      transform: "scale(1.1)",
    });

    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        image_position_x: 50,
        image_position_y: 50,
        image_zoom: 1.1,
      }),
    );
  });

  it("can reset image focus back to center", () => {
    render(
      <ToastProvider>
        <ProductForm
          initial={{ ...product, image_position_x: 20, image_position_y: 80, image_zoom: 2.0 }}
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

    expect(getPreviewImage()).toHaveStyle({
      objectPosition: "50% 50%",
      transform: "",
    });
  });
});
