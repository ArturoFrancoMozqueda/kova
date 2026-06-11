import { describe, expect, it } from "vitest";
import {
  SWEET_HOME_ACTIVE_SALE,
  SWEET_HOME_CASH_REGISTER,
  SWEET_HOME_INVENTORY,
  SWEET_HOME_PRODUCTS,
  SWEET_HOME_REPORTS,
  SWEET_HOME_SALE_TOTAL,
  sweetHomeSaleTotal,
} from "./sweetHome";

describe("Sweet Home demo data contract", () => {
  it("has 8 products with unique ids", () => {
    expect(SWEET_HOME_PRODUCTS).toHaveLength(8);
    expect(new Set(SWEET_HOME_PRODUCTS.map((p) => p.id)).size).toBe(8);
  });

  it("the active sale adds up to $186", () => {
    expect(sweetHomeSaleTotal()).toBe(186);
    expect(SWEET_HOME_SALE_TOTAL).toBe(186);
  });

  it("every sale line references an existing product", () => {
    const ids = new Set(SWEET_HOME_PRODUCTS.map((p) => p.id));
    for (const line of SWEET_HOME_ACTIVE_SALE.lines) {
      expect(ids.has(line.productId)).toBe(true);
    }
  });

  it("cash register math is consistent with the $186 cash sale", () => {
    const r = SWEET_HOME_CASH_REGISTER;
    expect(SWEET_HOME_ACTIVE_SALE.paymentMethod).toBe("cash");
    expect(r.newMovementAmount).toBe(SWEET_HOME_SALE_TOTAL);
    expect(r.cashSalesAfter).toBe(r.cashSalesBefore + SWEET_HOME_SALE_TOTAL);
    expect(r.expectedCashBefore).toBe(r.openingCash + r.cashSalesBefore - r.outflows);
    expect(r.expectedCashAfter).toBe(r.openingCash + r.cashSalesAfter - r.outflows);
    expect(r.expectedCashAfter).toBe(2040);
  });

  it("inventory movements match the products sold in the active sale", () => {
    const soldByProduct = new Map(
      SWEET_HOME_ACTIVE_SALE.lines.map((line) => [line.productId, line.qty]),
    );
    for (const item of SWEET_HOME_INVENTORY.items) {
      expect(item.stockAfter).toBe(item.stockBefore - item.sold);
      expect(item.sold).toBe(soldByProduct.get(item.productId) ?? 0);
      expect(item.low).toBe(item.stockAfter <= item.threshold);
    }
    expect(SWEET_HOME_INVENTORY.lowStockCount).toBe(
      SWEET_HOME_INVENTORY.items.filter((i) => i.low).length,
    );
  });

  it("reports totals are internally consistent", () => {
    const r = SWEET_HOME_REPORTS;
    expect(r.netSales).toBe(r.cashTotal + r.cardTotal);
    expect(r.cashTotal).toBe(SWEET_HOME_CASH_REGISTER.cashSalesAfter);
    expect(Math.round(r.netSales / r.orders)).toBe(r.avgTicket);
    expect(r.cashSharePct + r.cardSharePct).toBe(100);
    expect(Math.round((r.cashTotal / r.netSales) * 100)).toBe(r.cashSharePct);
    expect(SWEET_HOME_PRODUCTS.some((p) => p.id === r.topProductId)).toBe(true);
  });
});
