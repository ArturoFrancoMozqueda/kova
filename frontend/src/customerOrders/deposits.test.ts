import { describe, expect, it } from "vitest";
import { heldByMethod } from "./deposits";
import type { CustomerOrderDepositEntry } from "./types";

const entry = (kind: CustomerOrderDepositEntry["kind"], method: CustomerOrderDepositEntry["method"], amount: string) =>
  ({ id: `${kind}-${method}-${amount}`, kind, method, amount, reference: null, reason: null, created_at: "2026-11-27T12:00:00Z" });

describe("heldByMethod", () => {
  it("nets returns against what each method received and drops what was fully returned", () => {
    expect(heldByMethod([
      entry("deposit", "cash", "300.00"),
      entry("deposit", "bank_transfer", "100.00"),
      entry("refund", "cash", "120.50"),
      entry("refund", "bank_transfer", "100.00"),
      entry("retained", null, "10.00"),
    ])).toEqual({ cash: "179.50" });
  });
});
