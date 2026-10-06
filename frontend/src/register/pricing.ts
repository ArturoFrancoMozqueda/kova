import { moneyToCents } from "@/lib/money";

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Integer arithmetic matches backend Decimal ROUND_HALF_UP, including allocations. */
export function calculateSalePricing(lines: number[], discount: string, rate: string) {
  const subtotal = lines.reduce((sum, value) => sum + value, 0);
  const discountCents = moneyToCents(discount);
  const rateBasisPoints = moneyToCents(rate);
  if (![subtotal, discountCents, rateBasisPoints, ...lines].every(Number.isSafeInteger)
      || discountCents < 0 || discountCents > subtotal || rateBasisPoints < 0 || rateBasisPoints > 10000) {
    return { valid: false, subtotal, discount: 0, tax: 0, total: subtotal, allocated: lines };
  }
  const tax = Number(roundRatio(BigInt(subtotal - discountCents) * BigInt(rateBasisPoints), 10000n));
  const total = subtotal - discountCents + tax;
  function allocate(weights: number[], amount: number) {
    const denominator = weights.reduce((sum, value) => sum + value, 0);
    let cumulative = 0;
    let previous = 0;
    return weights.map((weight) => {
      cumulative += weight;
      const current = denominator ? Number(roundRatio(BigInt(amount) * BigInt(cumulative), BigInt(denominator))) : 0;
      const value = current - previous;
      previous = current;
      return value;
    });
  }
  const netLines = allocate(lines, subtotal - discountCents);
  const taxes = allocate(netLines, tax);
  const allocated = netLines.map((net, index) => net + taxes[index]);
  return { valid: true, subtotal, discount: discountCents, tax, total, allocated };
}

export function cachedTaxRate(tenantId: string | null): string {
  try {
    const rate = localStorage.getItem(`kova.register.tax.${tenantId}`) ?? "0.00";
    const value = moneyToCents(rate);
    return Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? rate : "0.00";
  } catch { return "0.00"; }
}

export function cacheTaxRate(tenantId: string, rate: string): void {
  try { localStorage.setItem(`kova.register.tax.${tenantId}`, rate); } catch { /* Storage may be unavailable. */ }
}
