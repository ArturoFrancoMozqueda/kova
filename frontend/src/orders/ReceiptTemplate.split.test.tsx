import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReceiptTemplate } from "./ReceiptTemplate";

it("prints one ticket with each person's lines and payment", () => {
  render(<ReceiptTemplate businessName="Café Aurora" createdAt="2026-11-27T12:00:00Z"
    subtotalAmount="180.00" discountAmount="18.00" totalAmount="162.00"
    items={[
      { product_name: "Latte", quantity: 1, unit_price_amount: "55.00", line_total_amount: "49.50", split_group: 1 },
      { product_name: "Latte", quantity: 1, unit_price_amount: "55.00", line_total_amount: "49.50", split_group: 2 },
      { product_name: "Sándwich", quantity: 1, unit_price_amount: "70.00", line_total_amount: "63.00", split_group: 2 },
    ]}
    payments={[
      { method: "cash", amount_amount: "49.50", split_group: 1 },
      { method: "manual_card", amount_amount: "112.50", split_group: 2 },
    ]} />);
  expect(screen.getByText("Persona 1")).toBeVisible();
  expect(screen.getByText("Persona 2")).toBeVisible();
  // Person 2's heading carries their subtotal; their payment line shows the same amount.
  expect(screen.getAllByText("$112.50")).toHaveLength(2);
  expect(screen.getByText("Persona 1 · Efectivo")).toBeVisible();
  expect(screen.getByText("Persona 2 · Tarjeta manual")).toBeVisible();
});

it("keeps an undivided ticket as before", () => {
  render(<ReceiptTemplate businessName="Café" createdAt="2026-11-27T12:00:00Z" subtotalAmount="55.00" totalAmount="55.00"
    items={[{ product_name: "Latte", quantity: 1, unit_price_amount: "55.00", line_total_amount: "55.00" }]}
    payments={[{ method: "cash", amount_amount: "55.00" }]} />);
  expect(screen.queryByText(/Persona/)).not.toBeInTheDocument();
  expect(screen.getByText("Efectivo")).toBeVisible();
});
