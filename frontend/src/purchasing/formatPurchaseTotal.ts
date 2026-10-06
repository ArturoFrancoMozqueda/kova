type PurchaseLine = { quantity: number; unit_cost: string };

/** Preview only; compute cents exactly even when a large purchase exceeds Number precision. */
export function formatPurchaseTotal(lines: PurchaseLine[]): string {
  let cents = 0n;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || !/^\d+(?:\.\d{0,2})?$/.test(line.unit_cost)) {
      return "Completa las cantidades y los costos";
    }
    const [whole, fraction = ""] = line.unit_cost.split(".");
    cents += BigInt(line.quantity) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
  }
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })
    .formatToParts(cents / 100n)
    .map(part => part.type === "fraction" ? (cents % 100n).toString().padStart(2, "0") : part.value)
    .join("");
}
