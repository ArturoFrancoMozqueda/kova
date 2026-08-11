import { formatDateTime } from "@/orders/format";

export function formatShiftDateTime(value: string | Date): string {
  return formatDateTime(value);
}

/** Whole days a shift has been open, or `null` when the timestamp is unusable.
 *
 * Used to warn that a corte has stopped being meaningful: expected cash keeps
 * accruing sales for as long as the shift stays open, so a multi-day shift
 * produces a variance nobody can reconcile against a real cash drawer. */
export function openShiftAgeInDays(openedAt: string | Date): number | null {
  const opened = openedAt instanceof Date ? openedAt : new Date(openedAt);
  const ms = opened.getTime();
  if (Number.isNaN(ms)) return null;
  const elapsed = Date.now() - ms;
  if (elapsed < 0) return null;
  return Math.floor(elapsed / (24 * 60 * 60 * 1000));
}

export function localizeShiftStatus(status: string | null | undefined): string {
  const normalized = normalizeEnum(status);
  if (normalized === "open") return "Abierto";
  if (normalized === "closed") return "Cerrado";
  return status || "Sin estado";
}

export function localizeMovementType(type: string | null | undefined): string {
  const normalized = normalizeEnum(type);
  if (normalized === "opening_balance") return "Apertura de caja";
  if (normalized === "cash_in") return "Entrada de efectivo";
  if (normalized === "cash_out") return "Salida de efectivo";
  if (normalized === "refund_payout") return "Reembolso en efectivo";
  return type || "Movimiento";
}

export function localizeMovementReason(reason: string | null | undefined): string {
  const normalized = normalizeEnum(reason);
  if (normalized === "opening_balance") return "Saldo inicial";
  if (normalized === "refund_payout") return "Reembolso de devolución";
  return reason || "Sin motivo";
}

export function localizeReconciliationStatus(status: string | null | undefined): string {
  const normalized = normalizeEnum(status);
  if (normalized === "balanced") return "Caja cuadrada";
  if (normalized === "overage") return "Sobrante";
  if (normalized === "shortage") return "Faltante";
  if (normalized === "closed") return "Cerrado";
  return status || "Cerrado";
}

export function isPositiveCashMovement(type: string | null | undefined): boolean {
  const normalized = normalizeEnum(type);
  return normalized === "cash_in" || normalized === "opening_balance";
}

function normalizeEnum(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replaceAll(" ", "_");
}
