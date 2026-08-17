import { describe, expect, it } from "vitest";
import { centsToMoney, moneyToCents } from "./money";

describe("money input", () => {
  it("parses ordinary decimal amounts exactly", () => {
    expect(moneyToCents("56")).toBe(5600);
    expect(moneyToCents("56.7")).toBe(5670);
    expect(moneyToCents(".25")).toBe(25);
    expect(centsToMoney(5670)).toBe("56.70");
  });

  it.each(["1e3", "12.345", "--1", "Infinity", "NaN"])(
    "rejects ambiguous money input %s",
    (value) => expect(moneyToCents(value)).toBeNaN(),
  );
});
