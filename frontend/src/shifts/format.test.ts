import { describe, expect, it } from "vitest";
import {
  isPositiveCashMovement,
  localizeMovementReason,
  localizeMovementType,
  localizeReconciliationStatus,
  localizeShiftStatus,
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

  it("classifies positive drawer movements", () => {
    expect(isPositiveCashMovement("opening_balance")).toBe(true);
    expect(isPositiveCashMovement("cash_in")).toBe(true);
    expect(isPositiveCashMovement("cash_out")).toBe(false);
    expect(isPositiveCashMovement("refund_payout")).toBe(false);
  });
});
