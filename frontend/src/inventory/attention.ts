import type { InventoryVelocityItem } from "./types";
import { INVENTORY_THRESHOLDS, parseDaysUntilOut } from "@/reports/utils/calculations";

export type InventoryAttentionLevel = "critical" | "restock" | null;

/** Keep operational attention limited to stock that needs action this week. */
export function inventoryVelocityAttention(item: InventoryVelocityItem): InventoryAttentionLevel {
  if (item.stock_on_hand <= 0) return "critical";
  const days = parseDaysUntilOut(item.days_until_out);
  if (days === null || days > INVENTORY_THRESHOLDS.restockDays) return null;
  return days <= INVENTORY_THRESHOLDS.criticalDays ? "critical" : "restock";
}

export function isActionableInventoryVelocity(item: InventoryVelocityItem): boolean {
  return inventoryVelocityAttention(item) !== null;
}
