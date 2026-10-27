import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SaleCustomerSummary } from "./SaleCustomerSummary";

it("keeps the selected name and both explicit actions accessible", async () => {
  const onChange = vi.fn(), onClear = vi.fn();
  const { container } = render(<SaleCustomerSummary name="Ana del Patio" disabled={false} onChange={onChange} onClear={onClear} />);
  expect(screen.getByRole("region", { name: "Cliente de esta venta" })).toHaveTextContent("Ana del Patio");
  fireEvent.click(screen.getByRole("button", { name: "Cambiar cliente de la venta" }));
  expect(onChange).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Quitar cliente de la venta" }));
  expect(onClear).toHaveBeenCalledOnce();
  expect((await axe(container, { runOnly: ["region", "button-name"] })).violations).toEqual([]);
});

it("blocks customer changes while a financial command is pending", () => {
  const onChange = vi.fn(), onClear = vi.fn();
  render(<SaleCustomerSummary name="Ana del Patio" disabled onChange={onChange} onClear={onClear} />);
  for (const button of screen.getAllByRole("button")) { expect(button).toBeDisabled(); fireEvent.click(button); }
  expect(onChange).not.toHaveBeenCalled(); expect(onClear).not.toHaveBeenCalled();
});
