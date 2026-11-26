/** Stock is counted in whole base units; these helpers make it readable. */
export type StockUnit = "pza" | "g" | "ml";

export const STOCK_UNITS: readonly StockUnit[] = ["pza", "g", "ml"];

export const stockUnitLabels: Record<StockUnit, string> = {
  pza: "Piezas",
  g: "Gramos",
  ml: "Mililitros",
};

const plain = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

export function stockUnitOf(product: { stock_unit?: StockUnit | null } | null | undefined): StockUnit {
  return product?.stock_unit ?? "pza";
}

/** 1500 ml → "1.5 L", 750 g → "750 g", 3 pza → "3 pza". */
export function formatStockQuantity(quantity: number, unit: StockUnit = "pza"): string {
  if (unit === "pza") return `${plain.format(quantity)} pza`;
  const large = unit === "g" ? "kg" : "L";
  if (Math.abs(quantity) >= 1000) return `${plain.format(quantity / 1000)} ${large}`;
  return `${plain.format(quantity)} ${unit}`;
}

/** "2 Litro (2 L)" for purchase lines; plain stock units when there is no purchase unit. */
export function formatPurchaseQuantity(
  quantity: number,
  purchaseUnitLabel: string | null | undefined,
  unitsPerPurchase: number | null | undefined,
  unit: StockUnit = "pza",
): string {
  if (!purchaseUnitLabel || !unitsPerPurchase || unitsPerPurchase === 1) return formatStockQuantity(quantity, unit);
  return `${plain.format(quantity)} × ${purchaseUnitLabel} (${formatStockQuantity(quantity * unitsPerPurchase, unit)})`;
}

export function isSellable(product: { is_sellable?: boolean | null }): boolean {
  return product.is_sellable !== false;
}
