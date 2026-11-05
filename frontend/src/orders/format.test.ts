import { describe, expect, it } from "vitest";
import { reasonLabel } from "./format";

describe("reasonLabel", () => {
  it.each([
    ["operator_error", "Error del operador"],
    ["wrong_product", "Producto equivocado"],
    ["system_issue", "Problema del sistema"],
    ["customer_return", "Devolución de cliente"],
    ["defective", "Defectuoso"],
    ["wrong_item", "Producto equivocado"],
    ["other", "Otro"],
  ])("localiza el motivo %s como %s", (reason, label) => {
    expect(reasonLabel(reason)).toBe(label);
  });

  it.each([
    ["cash", "Efectivo"],
    ["bank_transfer", "Transferencia"],
    ["manual_card", "Tarjeta manual"],
    ["damaged_item", "Producto dañado"],
    ["wrong_order", "Orden incorrecta"],
  ])("conserva la etiqueta existente de %s", (reason, label) => {
    expect(reasonLabel(reason)).toBe(label);
  });

  it("conserva el texto libre y el fallback existente de motivos desconocidos", () => {
    expect(reasonLabel("El cliente cambió de opinión")).toBe("El cliente cambió de opinión");
    expect(reasonLabel("legacy_reason")).toBe("legacy reason");
  });
});
