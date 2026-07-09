import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoidModal } from "./VoidModal";
import { RefundModal } from "./RefundModal";
import { copy } from "@/i18n/messages";
import type { OrderItem } from "./types";

describe("VoidModal accessibility & localization", () => {
  it("associates the reason select with its label", () => {
    render(<VoidModal disabled={false} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(copy.voidModal.reason)).toBeInTheDocument();
  });

  it("renders reason options localized in es-MX", () => {
    render(<VoidModal disabled={false} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText(copy.voidModal.reasons.operator_error)).toBeInTheDocument();
    expect(screen.getByText(copy.voidModal.reasons.system_issue)).toBeInTheDocument();
    // No raw English enum values leak through.
    expect(screen.queryByText("operator error")).toBeNull();
  });
});

describe("RefundModal accessibility", () => {
  const items: OrderItem[] = [
    {
      id: "item-1",
      product_id: "prod-1",
      product_name: "Café Americano",
      quantity: 2,
      unit_price_amount: "45.00",
      line_total_amount: "90.00",
      modifiers: [],
    },
  ];

  it("associates both selects with their labels", () => {
    render(<RefundModal items={items} disabled={false} onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(copy.refundModal.reason)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.refundModal.refundPaymentMethod)).toBeInTheDocument();
  });
});
