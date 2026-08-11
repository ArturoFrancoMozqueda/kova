import { describe, expect, it } from "vitest";
import {
  isPositiveCashMovement,
  localizeMovementReason,
  localizeMovementType,
  localizeReconciliationStatus,
  localizeShiftStatus,
  openShiftAgeInDays,
} from "./format";

describe("shift format helpers", () => {
  it("localizes backend shift statuses", () => {
    expect(localizeShiftStatus("open")).toBe("Abierto");
    expect(localizeShiftStatus("Open")).toBe("Abierto");
    expect(localizeShiftStatus("closed")).toBe("Cerrado");
  });

  it("localizes movement types and opening balance reason defensively", () => {
    expect(localizeMovementType("OPENING_BALANCE")).toBe("Apertura de caja");
    expect(localizeMovementType("cash_in")).toBe("Entrada de efectivo");
    expect(localizeMovementType("cash_out")).toBe("Salida de efectivo");
    expect(localizeMovementType("refund_payout")).toBe("Reembolso en efectivo");
    expect(localizeMovementReason("Opening balance")).toBe("Saldo inicial");
  });

  it("localizes reconciliation statuses in business language", () => {
    expect(localizeReconciliationStatus("balanced")).toBe("Caja cuadrada");
    expect(localizeReconciliationStatus("overage")).toBe("Sobrante");
    expect(localizeReconciliationStatus("shortage")).toBe("Faltante");
  });

  // A production tenant was found with a shift open for 19 days, which quietly
  // makes its corte unreconcilable. The view warns past two days.
  it("measures how long a shift has been open, in whole days", () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
    expect(openShiftAgeInDays(hoursAgo(3))).toBe(0);
    expect(openShiftAgeInDays(hoursAgo(30))).toBe(1);
    expect(openShiftAgeInDays(hoursAgo(24 * 19))).toBe(19);
  });

  it("returns null for unusable or future open timestamps", () => {
    expect(openShiftAgeInDays("not-a-date")).toBeNull();
    // Clock skew on a cheap register should not render "-1 días abierto".
    expect(openShiftAgeInDays(new Date(Date.now() + 60_000).toISOString())).toBeNull();
  });

  it("classifies positive drawer movements", () => {
    expect(isPositiveCashMovement("opening_balance")).toBe(true);
    expect(isPositiveCashMovement("cash_in")).toBe(true);
    expect(isPositiveCashMovement("cash_out")).toBe(false);
    expect(isPositiveCashMovement("refund_payout")).toBe(false);
  });
});
