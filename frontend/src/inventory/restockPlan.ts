import type { InventoryVelocityItem, StockItem } from "./types";

export const RESTOCK_HORIZONS = [3, 7, 14] as const;
export type RestockHorizon = (typeof RESTOCK_HORIZONS)[number];

export type RestockDecision = {
  productId: string;
  productName: string;
  stockOnHand: number;
  reserved: number | null;
  available: number | null;
  unitsPerDay: number | null;
  coverageDays: number | null;
  targetUnits: number | null;
  suggestedUnits: number | null;
};

/** A planning estimate, never an inventory movement or a promise of future sales.
 * Velocity is inventory consumed by recorded sales in the trailing seven days.
 * Available stock already excludes reservations in the backend contract.
 */
export function restockDecision(
  stock: StockItem,
  velocity: InventoryVelocityItem | undefined,
  horizon: RestockHorizon,
): RestockDecision {
  const rate = velocity?.units_per_day_7d.trim();
  const parsedRate = rate ? Number(rate) : NaN;
  const unitsPerDay = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null;
  const validStock = Number.isSafeInteger(stock.stock_on_hand) && stock.stock_on_hand >= 0;
  const validReserved = Number.isSafeInteger(stock.reserved_quantity) && stock.reserved_quantity >= 0;
  const validAvailable = Number.isSafeInteger(stock.available_quantity)
    && stock.available_quantity >= 0
    && validStock && validReserved
    && stock.available_quantity === Math.max(0, stock.stock_on_hand - stock.reserved_quantity);
  const available = validAvailable ? stock.available_quantity : null;
  const target = unitsPerDay !== null ? Math.ceil(unitsPerDay * horizon) : null;
  const targetUnits = target !== null && Number.isSafeInteger(target) ? target : null;
  return {
    productId: stock.product_id,
    productName: stock.product_name,
    stockOnHand: stock.stock_on_hand,
    reserved: validReserved ? stock.reserved_quantity : null,
    available,
    unitsPerDay,
    coverageDays: available !== null && unitsPerDay !== null ? available / unitsPerDay : null,
    targetUnits,
    suggestedUnits: available !== null && targetUnits !== null
      ? Math.max(0, targetUnits - available) : null,
  };
}

export function buildRestockPlan(
  stock: StockItem[],
  velocity: InventoryVelocityItem[],
  horizon: RestockHorizon,
) {
  const velocityById = new Map(velocity.map((item) => [item.product_id, item]));
  const tracked = stock.filter((item) => item.track_inventory);
  const decisions = tracked.map((item) => ({
    stock: item,
    decision: restockDecision(item, velocityById.get(item.product_id), horizon),
  }));
  const items = decisions
    .filter(({ stock: item, decision }) =>
      item.stock_on_hand <= 0 || item.is_low_stock || decision.available === null
      || (decision.suggestedUnits !== null && decision.suggestedUnits > 0),
    )
    .map(({ decision }) => decision)
    .sort((a, b) => {
      // Known, urgent shortages first; missing data never masquerades as zero demand.
      const aDays = a.coverageDays ?? Number.POSITIVE_INFINITY;
      const bDays = b.coverageDays ?? Number.POSITIVE_INFINITY;
      return aDays - bDays || a.productName.localeCompare(b.productName, "es-MX");
    });
  return {
    items,
    trackedCount: tracked.length,
    unknownCount: decisions.filter(({ decision }) => decision.suggestedUnits === null).length,
  };
}

export function inventoryProductLink(productId: string): string {
  return `/inventory?${new URLSearchParams({ product: productId })}`;
}
