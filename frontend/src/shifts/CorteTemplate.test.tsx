import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { CorteTemplate } from "./CorteTemplate";
import type { CashMovement, Shift } from "./types";

function movement(type: CashMovement["type"], amount: string, id: string): CashMovement {
  return {
    id,
    shift_id: "shift-1",
    type,
    amount,
    reason: type,
    created_at: "2026-07-09T16:00:00.000Z",
  };
}

const closedShift: Shift = {
  id: "shift-1",
  tenant_id: "tenant-1",
  status: "closed",
  opening_cash_amount: "100.00",
  actual_cash_amount: "590.00",
  expected_cash_amount: "600.00",
  reconciliation_status: "shortage",
  variance_amount: "-10.00",
  opened_at: "2026-07-09T08:00:00.000Z",
  closed_at: "2026-07-09T20:00:00.000Z",
  movements: [
    movement("opening_balance", "100.00", "m0"),
    movement("cash_in", "50.00", "m1"),
    movement("cash_out", "20.00", "m2"),
    movement("refund_payout", "30.00", "m3"),
  ],
};

describe("CorteTemplate", () => {
  it("renders the business name and corte title", () => {
    render(<CorteTemplate businessName="Sweet Home" shift={closedShift} />);
    expect(screen.getByText("Sweet Home")).toBeInTheDocument();
    expect(screen.getByText(copy.corte.title)).toBeInTheDocument();
  });

  it("derives cash sales so the components tie to the frozen expected cash", () => {
    render(<CorteTemplate businessName="Sweet Home" shift={closedShift} />);

    // cash_sales = expected − opening − cash_in + cash_out + refund_payout
    //            = 600 − 100 − 50 + 20 + 30 = 500
    const opening = 100;
    const cashIn = 50;
    const cashOut = 20;
    const refundPayout = 30;
    const expected = 600;
    const cashSales = expected - opening - cashIn + cashOut + refundPayout;
    expect(cashSales).toBe(500);

    expect(screen.getByText(formatMoney(cashSales))).toBeInTheDocument();
    expect(screen.getByText(`+${formatMoney(cashIn)}`)).toBeInTheDocument();
    expect(screen.getByText(`-${formatMoney(cashOut)}`)).toBeInTheDocument();
    expect(screen.getByText(`-${formatMoney(refundPayout)}`)).toBeInTheDocument();

    // The frozen expected + counted + variance are shown verbatim.
    expect(screen.getByText(formatMoney(expected))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(590))).toBeInTheDocument();
    expect(screen.getByText(`-${formatMoney(10)}`)).toBeInTheDocument();
  });

  it("omits zero cash-movement lines but always shows opening and sales", () => {
    const simple: Shift = {
      ...closedShift,
      opening_cash_amount: "50.00",
      expected_cash_amount: "250.00",
      actual_cash_amount: "250.00",
      variance_amount: "0.00",
      reconciliation_status: "balanced",
      movements: [],
    };
    render(<CorteTemplate businessName="Sweet Home" shift={simple} />);

    expect(screen.getByText(copy.corte.openingCash)).toBeInTheDocument();
    expect(screen.getByText(copy.corte.cashSales)).toBeInTheDocument();
    expect(screen.queryByText(copy.corte.cashIn)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.corte.cashOut)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.corte.refundPayout)).not.toBeInTheDocument();
    // opening = 50, cash_sales = 250 − 50 = 200
    expect(screen.getByText(formatMoney(50))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(200))).toBeInTheDocument();
  });
});
