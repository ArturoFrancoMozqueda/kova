/** Peso steps a cashier typically rounds a cash payment up to. */
const ROUND_UP_STEPS_PESOS = [10, 50, 100, 200, 500, 1000];
const DEFAULT_BILLS_PESOS = [50, 100, 200, 500];

/**
 * Quick-cash amounts (in whole pesos) the customer is likely to hand over for
 * a given total: each value is the next multiple of a common step strictly
 * above the total, so it never duplicates the "Exacto" button. Falls back to
 * the common MXN bills while the cart is empty.
 */
export function suggestCashBills(totalCents: number, limit = 4): number[] {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return DEFAULT_BILLS_PESOS.slice(0, limit);
  const suggestions = new Set<number>();
  for (const step of ROUND_UP_STEPS_PESOS) {
    const stepCents = step * 100;
    const next = (Math.floor(totalCents / stepCents) + 1) * stepCents;
    suggestions.add(next / 100);
  }
  return [...suggestions].sort((a, b) => a - b).slice(0, limit);
}
