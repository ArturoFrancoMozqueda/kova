import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Product } from "@/catalog/types";
import { copy } from "@/i18n/messages";
import { IngredientLinesDialog } from "./IngredientLinesDialog";

const base: Product = {
  id: "milk", tenant_id: "t", category_id: null, name: "Leche entera", description: null, sku: null,
  price_amount: "0.00", cost_price: "25.00", track_inventory: true, is_sellable: false, stock_unit: "ml",
  purchase_unit_label: "Litro", purchase_unit_quantity: 1000, low_stock_threshold: null, image_url: null,
  image_position_x: 50, image_position_y: 50, image_zoom: 1, is_active: true, modifier_groups: [],
};
const coffee: Product = { ...base, id: "coffee", name: "Café en grano", stock_unit: "g" };

function renderDialog(overrides: Partial<Parameters<typeof IngredientLinesDialog>[0]> = {}) {
  const save = vi.fn().mockResolvedValue({
    lines: [{ ingredient_product_id: "milk", quantity: 240, ingredient_name: "Leche entera", stock_unit: "ml", cost: "6.00" }],
    cost: "6.00",
  });
  render(
    <IngredientLinesDialog
      title="Receta de Latte" description="d" ingredients={[base, coffee]}
      load={vi.fn().mockResolvedValue({ lines: [], cost: null })}
      save={save} onClose={vi.fn()} onSaved={vi.fn()} {...overrides}
    />,
  );
  return save;
}

describe("IngredientLinesDialog", () => {
  it("saves whole positive amounts and shows the server cost", async () => {
    const save = renderDialog();
    await screen.findByText(copy.recipes.emptyRecipe);
    fireEvent.click(screen.getByRole("button", { name: copy.recipes.addIngredient }));
    fireEvent.change(screen.getByLabelText(copy.recipes.ingredient), { target: { value: "milk" } });
    fireEvent.change(screen.getByLabelText(copy.recipes.quantity("ml")), { target: { value: "240" } });
    fireEvent.click(screen.getByRole("button", { name: copy.recipes.save }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual([{ ingredient_product_id: "milk", quantity: 240 }]);
    expect(await screen.findByText(copy.recipes.recipeCost("$6.00"))).toBeInTheDocument();
  });

  it("rejects negative amounts in a recipe but accepts them for an option", async () => {
    const save = renderDialog();
    await screen.findByText(copy.recipes.emptyRecipe);
    fireEvent.click(screen.getByRole("button", { name: copy.recipes.addIngredient }));
    fireEvent.change(screen.getByLabelText(copy.recipes.ingredient), { target: { value: "milk" } });
    fireEvent.change(screen.getByLabelText(copy.recipes.quantity("ml")), { target: { value: "-240" } });
    expect(screen.getByText(copy.recipes.invalid(false))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.recipes.save })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reuses the idempotency key when a save is retried after a lost response", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ lines: [], cost: null });
    renderDialog({
      signed: true,
      save,
      load: vi.fn().mockResolvedValue({ lines: [{ ingredient_product_id: "milk", quantity: -240, ingredient_name: "Leche entera", stock_unit: "ml", cost: "-6.00" }], cost: "-6.00" }),
    });
    fireEvent.click(await screen.findByRole("button", { name: copy.recipes.remove("Leche entera") }));
    fireEvent.click(screen.getByRole("button", { name: copy.recipes.save }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: copy.recipes.save }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);
  });

  it("shows an incomplete cost instead of zero", async () => {
    renderDialog({
      load: vi.fn().mockResolvedValue({ lines: [{ ingredient_product_id: "milk", quantity: 240, ingredient_name: "Leche entera", stock_unit: "ml", cost: null }], cost: null }),
    });
    expect(await screen.findByText(copy.recipes.incompleteCost("$0.00", 1))).toBeInTheDocument();
  });
});
