import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefundModal } from "./RefundModal";
import { copy } from "../i18n/messages";

describe("RefundModal quantities", () => {
  it("returns one indivisible item through both original payment methods", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RefundModal
      items={[{ id: "line-1", product_id: "product-1", product_name: "Pastel", quantity: 1, unit_price_amount: "50.00", line_total_amount: "50.00", modifiers: [] }]}
      availablePayments={[{ method: "cash", amount: "30.00" }, { method: "bank_transfer", amount: "20.00" }]}
      disabled={false} onCancel={vi.fn()} onSubmit={onSubmit}
    />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /Pastel/ }), { target: { value: "1" } });
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByText("$20.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.refundModal.submit }));
    expect(onSubmit).toHaveBeenCalledWith({ reason: "customer_return", items: [{ order_item_id: "line-1", quantity: 1 }], refund_payments: [{ method: "cash", amount: "30.00" }, { method: "bank_transfer", amount: "20.00" }] });
  });
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

  it("asks whether stocked units go back and keeps older payload shapes for other lines", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RefundModal
      items={[
        { id: "line-1", product_id: "product-1", product_name: "Concha", quantity: 2, unit_price_amount: "10.00", line_total_amount: "20.00", modifiers: [], stock_consumed: true },
        { id: "line-2", product_id: "product-2", product_name: "Empaque", quantity: 1, unit_price_amount: "5.00", line_total_amount: "5.00", modifiers: [], stock_consumed: false },
      ]}
      disabled={false} onCancel={vi.fn()} onSubmit={onSubmit}
    />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /Concha/ }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Empaque/ }), { target: { value: "1" } });
    const restock = screen.getByRole("checkbox", { name: new RegExp(copy.refundModal.restock) });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(restock).toBeChecked();

    fireEvent.change(screen.getByLabelText(copy.refundModal.reason), { target: { value: "defective" } });
    expect(restock).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: copy.refundModal.submit }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({
      reason: "defective",
      items: [{ order_item_id: "line-1", quantity: 1, restock: false }, { order_item_id: "line-2", quantity: 1 }],
    }));

    fireEvent.click(restock);
    fireEvent.change(screen.getByLabelText(copy.refundModal.reason), { target: { value: "other" } });
    expect(restock).toBeChecked();
  });

  it("replays a stored intent with its original restock choice", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const payload = { reason: "customer_return", refund_payment_method: "cash" as const, items: [{ order_item_id: "line-1", quantity: 1, restock: false }] };
    render(<RefundModal
      items={[{ id: "line-1", product_id: "product-1", product_name: "Concha", quantity: 2, unit_price_amount: "10.00", line_total_amount: "20.00", modifiers: [], stock_consumed: true }]}
      fieldsLocked initialPayload={payload}
      disabled={false} onCancel={vi.fn()} onSubmit={onSubmit}
    />);
    const restock = screen.getByRole("checkbox", { name: new RegExp(copy.refundModal.restock) });
    expect(restock).not.toBeChecked();
    expect(restock).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: copy.refundModal.submit }));
    expect(onSubmit).toHaveBeenLastCalledWith(payload);
  });
});
