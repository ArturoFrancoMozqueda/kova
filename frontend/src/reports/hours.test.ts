import { describe, expect, it } from "vitest";

import { formatHourRange, topHoursByNetSales, totalNetSales } from "./hours";
import type { SalesByHourRow } from "./types";

const row = (hour: number, net: string, orders = 1): SalesByHourRow => ({
  hour,
  net_sales: net,
  order_count: orders,
});

describe("formatHourRange", () => {
  it("formats a daytime hour as a zero-padded range", () => {
    expect(formatHourRange(9)).toBe("09:00–10:00");
  });

  it("wraps past midnight", () => {
    expect(formatHourRange(23)).toBe("23:00–00:00");
  });
});

describe("topHoursByNetSales", () => {
  it("drops hours without sales, ranks by net sales desc, and caps at n", () => {
    const rows = [
      row(9, "25.00"),
      row(13, "60.00"),
      row(0, "0.00"),
      row(18, "40.00"),
    ];
    expect(topHoursByNetSales(rows, 3).map((r) => r.hour)).toEqual([13, 18, 9]);
  });

  it("returns empty when no hour has sales", () => {
    expect(topHoursByNetSales([row(1, "0.00"), row(2, "0.00")], 3)).toEqual([]);
  });
});

describe("totalNetSales", () => {
  it("sums net sales across every hour, including zero-sale hours", () => {
    expect(totalNetSales([row(9, "25.00"), row(13, "60.00"), row(0, "0.00")])).toBe(85);
  });

  it("returns 0 for an empty set", () => {
    expect(totalNetSales([])).toBe(0);
  });
});
