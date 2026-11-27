import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SplitBillPanel, newPersonPayment, splitBillReady } from "./SplitBillPanel";

it("assigns units to people and collects each person's payment", () => {
  const onAssign = vi.fn();
  const onPaymentChange = vi.fn();
  const onPeopleChange = vi.fn();
  render(<SplitBillPanel idPrefix="t" people={2} totals={[5500, 7000]} cashAllowed={false}
    lines={[{ key: "latte", name: "Latte", quantity: 2 }, { key: "pan", name: "Pan", detail: "Tostado", quantity: 1 }]}
    owners={{ latte: [0, 1], pan: [1] }} payments={[newPersonPayment(), newPersonPayment()]}
    onAssign={onAssign} onPaymentChange={onPaymentChange} onPeopleChange={onPeopleChange} />);

  fireEvent.change(screen.getByLabelText(/Latte \(2 de 2\)/), { target: { value: "0" } });
  expect(onAssign).toHaveBeenCalledWith("latte", 1, 0);
  const second = screen.getByRole("region", { name: "Persona 2" });
  expect(within(second).getByText("$70.00")).toBeVisible();
  expect(within(second).getByRole("option", { name: "Efectivo" })).toBeDisabled();
  fireEvent.change(within(second).getByLabelText("Paga con"), { target: { value: "manual_card" } });
  expect(onPaymentChange).toHaveBeenCalledWith(1, { method: "manual_card", tendered: "", reference: "" });
  fireEvent.click(screen.getByRole("button", { name: "Agregar una persona" }));
  expect(onPeopleChange).toHaveBeenCalledWith(3);
  expect(screen.getByRole("button", { name: "Quitar una persona" })).toBeDisabled();
});

it("is ready only when every person who owes has a valid payment", () => {
  const cash = { method: "cash" as const, tendered: "50", reference: "" };
  expect(splitBillReady([5500, 0], [cash, newPersonPayment()], true)).toBe(false);
  expect(splitBillReady([5500, 0], [{ ...cash, tendered: "60" }, newPersonPayment()], true)).toBe(true);
  expect(splitBillReady([5500, 0], [{ ...cash, tendered: "60" }, newPersonPayment()], false)).toBe(false);
  expect(splitBillReady([0, 0], [newPersonPayment(), newPersonPayment()], true)).toBe(false);
});
