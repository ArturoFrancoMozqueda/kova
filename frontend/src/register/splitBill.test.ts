import { describe, expect, it } from "vitest";
import { pedidoPersonDue, personTotals, splitParts, unitsOf } from "./splitBill";

const lines = [
  { key: "latte", quantity: 2, unitCents: 5500 },
  { key: "sandwich", quantity: 1, unitCents: 7000 },
];

describe("split bill", () => {
  it("gives every unit to the first person until assigned, and drops people that were removed", () => {
    expect(unitsOf(lines[0], {}, 3)).toEqual([0, 0]);
    expect(unitsOf(lines[0], { latte: [2, 1] }, 2)).toEqual([0, 1]);
  });

  it("prices the split lines like the server: a shared discount by line, to the cent", () => {
    // Same case as backend test_split_bill: $180 − $18 → 49.50 + 49.50 + 63.00.
    const split = personTotals(lines, { latte: [0, 1], sandwich: [2] }, 3, "18.00", "0.00");
    expect(split.parts).toEqual([
      { key: "latte", person: 0, quantity: 1 },
      { key: "latte", person: 1, quantity: 1 },
      { key: "sandwich", person: 2, quantity: 1 },
    ]);
    expect(split.totals).toEqual([4950, 4950, 6300]);
    expect(split.totals.reduce((sum, value) => sum + value, 0)).toBe(16200);
  });

  it("keeps one line per person even when they share a product", () => {
    expect(splitParts(lines, { latte: [1, 1] }, 2)).toEqual([
      { key: "latte", person: 1, quantity: 2 },
      { key: "sandwich", person: 0, quantity: 1 },
    ]);
  });

  it("shares a pedido deposit by what each person had", () => {
    // Same case as backend: two $300 cakes, $150 deposit → each pays $225.
    const result = pedidoPersonDue([{ key: "cake", quantity: 2, lineTotalCents: 60000 }], { cake: [0, 1] }, 2, 15000);
    expect(result).toMatchObject({ owed: [30000, 30000], credits: [7500, 7500], due: [22500, 22500] });
    expect(result.groups).toEqual([{ key: "cake", person: 0, quantity: 1 }, { key: "cake", person: 1, quantity: 1 }]);
  });

  it("splits an odd line total without losing a cent", () => {
    const result = pedidoPersonDue([{ key: "pan", quantity: 3, lineTotalCents: 1000 }], { pan: [0, 1, 1] }, 2, 0);
    expect(result.owed).toEqual([333, 667]);
  });
});
