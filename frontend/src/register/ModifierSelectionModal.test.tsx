import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { copy } from "@/i18n/messages";
import type { ModifierGroup } from "@/catalog/types";
import { ModifierSelectionModal } from "./ModifierSelectionModal";

function group(overrides: Partial<ModifierGroup>): ModifierGroup {
  return {
    id: "size",
    tenant_id: "tenant-1",
    name: "Tamaño",
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 0,
    is_active: true,
    options: [
      { id: "small", group_id: "size", name: "Chico", price_delta: "0.00", sort_order: 0, is_active: true },
      { id: "large", group_id: "size", name: "Grande", price_delta: "10.00", sort_order: 1, is_active: true },
    ],
    ...overrides,
  };
}

describe("ModifierSelectionModal", () => {
  it("preselects the first option of required single-choice groups so the usual order is one tap", () => {
    const onConfirm = vi.fn();
    render(
      <ModifierSelectionModal productName="Latte" modifierGroups={[group({})]} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );

    expect(screen.getByRole("radio", { name: /Chico/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: copy.modifierModal.addToCart }));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ groupId: "size", optionId: "small", optionName: "Chico" }),
    ]);
  });

  it("skips inactive options when preselecting", () => {
    const sizes = group({});
    sizes.options[0] = { ...sizes.options[0], is_active: false };
    render(<ModifierSelectionModal productName="Latte" modifierGroups={[sizes]} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /Grande/ })).toBeChecked();
  });

  it("does not preselect optional or multi-choice groups and explains what is missing", () => {
    const extras = group({
      id: "extras",
      name: "Extras",
      min_selections: 1,
      max_selections: 2,
      options: [
        { id: "shot", group_id: "extras", name: "Carga extra", price_delta: "8.00", sort_order: 0, is_active: true },
      ],
    });
    const syrup = group({ id: "syrup", name: "Jarabe", is_required: false });
    render(
      <ModifierSelectionModal productName="Latte" modifierGroups={[extras, syrup]} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByRole("checkbox", { name: /Carga extra/ })).not.toBeChecked();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.getByRole("button", { name: copy.modifierModal.addToCart })).toBeDisabled();
    expect(screen.getByText(copy.modifierModal.missingRequired("Extras"))).toBeVisible();
  });
});
