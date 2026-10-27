import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReceiptDisplay } from "./ReceiptDisplay";
import type { Order, Receipt } from "./types";

it("conserva importes y cantidades devueltos sin imprimir identificadores de productos ausentes", () => {
  const internalId = "11111111-1111-4111-8111-111111111111";
  const order: Order = {
    id: "sale", tenant_id: "business", status: "completed", subtotal_amount: "50.00", total_amount: "50.00",
    items: [], payments: [],
  };
  const receipt: Receipt = {
    order_id: order.id, receipt_number: "V-184", tenant_name: "Café del Patio", created_at: "2026-10-26T12:00:00Z",
    status: "completed", items: [], subtotal_amount: "50.00", total_amount: "50.00", payments: [],
    total_tendered: "50.00", total_change: "0.00", void: null,
    refunds: [{ id: "refund", reason: "customer_return", refunded_amount: "25.00", created_at: "2026-10-26T12:15:00Z",
      items: [{ order_item_id: internalId, quantity: 1, unit_price_amount: "25.00", line_total_amount: "25.00" }] }],
  };
  render(<ReceiptDisplay order={order} receipt={receipt} />);
  expect(screen.getByText("Producto de la devolución x1")).toBeVisible();
  expect(screen.queryByText(internalId)).not.toBeInTheDocument();
  expect(screen.getAllByText("-$25.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("$50.00").length).toBeGreaterThan(0);
  expect(screen.getByText("V-184", { exact: true })).toBeVisible();
});
