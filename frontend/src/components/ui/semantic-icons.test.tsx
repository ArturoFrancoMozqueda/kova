import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { paymentLabels, statusLabels, fulfillmentLabels } from "@/customerOrders/labels";
import { semanticIcon, semanticIcons } from "./semantic-icons";
import { StatusBadge } from "./status-badge";

it("has an icon for every customer order, payment and delivery state that has a label", () => {
  for (const value of Object.keys(statusLabels)) expect(semanticIcons.customerOrderStatus).toHaveProperty(value);
  for (const value of Object.keys(paymentLabels)) expect(semanticIcons.customerOrderPayment).toHaveProperty(value);
  for (const value of Object.keys(fulfillmentLabels)) expect(semanticIcons.fulfillment).toHaveProperty(value);
});

it("falls back to a neutral icon for unknown values instead of failing", () => {
  expect(semanticIcon("sale", "future_state").tone).toBe("neutral");
  expect(semanticIcon("sale", null).tone).toBe("neutral");
  expect(semanticIcon("sale", "toString").tone).toBe("neutral");
});

it("always shows the label as text with a decorative icon", () => {
  render(<StatusBadge domain="customerOrderPayment" value="unpaid" label="Pendiente de cobro" />);
  const badge = screen.getByText("Pendiente de cobro");
  expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(badge).toHaveTextContent(/^Pendiente de cobro$/);
});

it("covers appointment, purchase, stock and role states shown in the app", () => {
  for (const value of ["scheduled", "completed", "no_show", "cancelled"]) expect(semanticIcons.appointment).toHaveProperty(value);
  for (const value of ["pending", "partial", "received", "cancelled"]) expect(semanticIcons.purchase).toHaveProperty(value);
  for (const value of ["low", "out"]) expect(semanticIcons.stock).toHaveProperty(value);
  for (const value of ["owner", "manager", "cashier", "staff"]) expect(semanticIcons.role).toHaveProperty(value);
});
