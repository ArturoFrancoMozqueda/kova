const MONEY_INPUT = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;

/**
 * Parses a user-entered decimal amount without accepting exponent notation or
 * silently truncating extra decimal places. Invalid values return NaN so form
 * validation stays closed instead of submitting a different amount.
 */
export function moneyToCents(value: string): number {
  const normalized = value.trim();
  if (!normalized) return 0;
  if (!MONEY_INPUT.test(normalized)) return Number.NaN;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number.parseInt(whole || "0", 10) * 100 + Number.parseInt(`${fraction}00`.slice(0, 2), 10);
}

export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "0.00";
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
