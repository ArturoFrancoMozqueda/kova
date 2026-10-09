import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefundModal } from "./RefundModal";
import { copy } from "../i18n/messages";

describe("RefundModal quantities", () => {
  it("submits whole units within the refundable maximum", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RefundModal
      items={[{ id: "line-1", product_id: "product-1", product_name: "Concha", quantity: 3, unit_price_amount: "25.00", line_total_amount: "75.00", modifiers: [] }]}
      disabled={false}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
    />);
    const input = screen.getByRole("spinbutton", { name: /Concha/ });
    const submit = screen.getByRole("button", { name: copy.refundModal.submit });

    fireEvent.change(input, { target: { value: "0.5" } });
    expect(input).toHaveValue(0);
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "1.5" } });
    expect(input).toHaveValue(1);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ items: [{ order_item_id: "line-1", quantity: 1 }] }));

    fireEvent.change(input, { target: { value: "10" } });
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: "-1" } });
    expect(input).toHaveValue(0);
    expect(submit).toBeDisabled();
  });
});
