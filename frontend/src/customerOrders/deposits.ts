import { centsToMoney, moneyToCents } from "@/lib/money";
import type { CustomerOrderDepositEntry, DepositMethod } from "./types";

export const centsOf = (value: string): number => moneyToCents(value || "0");
export const moneyOf = (cents: number): string => centsToMoney(Math.max(cents, 0));

/** Deposit money still held per method: received minus returned (same rule as the server). */
export function heldByMethod(entries: CustomerOrderDepositEntry[]): Partial<Record<DepositMethod, string>> {
  const cents: Partial<Record<DepositMethod, number>> = {};
  for (const entry of entries) {
    if (!entry.method) continue;
    const sign = entry.kind === "deposit" ? 1 : entry.kind === "refund" ? -1 : 0;
    cents[entry.method] = (cents[entry.method] ?? 0) + sign * centsOf(entry.amount);
  }
  return Object.fromEntries(
    Object.entries(cents).filter(([, value]) => (value ?? 0) > 0).map(([method, value]) => [method, moneyOf(value ?? 0)]),
  ) as Partial<Record<DepositMethod, string>>;
}
