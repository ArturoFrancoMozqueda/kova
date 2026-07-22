import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegisterProductCard } from "./RegisterPresentation";

describe("RegisterProductCard", () => {
  it("explains an unavailable product without adding it", () => {
    const onAdd = vi.fn();
    const onDisabledSelect = vi.fn();

    render(
      <RegisterProductCard
        ariaLabel="Americano chico — sin stock. Actualiza inventario para vender."
        disabled
        name="Americano chico"
        price="38.00"
        onAdd={onAdd}
        onDisabledSelect={onDisabledSelect}
      />,
    );

    const product = screen.getByRole("button", { name: /americano chico.*sin stock/i });
    expect(product).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(product);

    expect(onDisabledSelect).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
