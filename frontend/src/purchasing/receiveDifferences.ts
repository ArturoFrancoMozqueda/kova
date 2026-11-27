import type { PurchaseItem } from "./api";

/** What the person typed for one purchase line while receiving. */
export type ReceiveDraft = { quantity: number; closeRemaining: boolean; reason: string };

export type ReceiveLine = {
  item_id: string;
  quantity: number;
  close_remaining?: true;
  difference_reason?: string;
};

export const pendingUnits = (item: PurchaseItem) => Math.max(0, item.quantity - item.received_quantity);

/** Lines that still expect merchandise: not closed and with units pending. */
export const openLines = (items: PurchaseItem[]) => items.filter(item => !item.closed_at && pendingUnits(item) > 0);

/** "over" when more arrived than ordered; "short" when the line closes with units missing. */
export function receiveDifference(item: PurchaseItem, draft: ReceiveDraft): "over" | "short" | null {
  const pending = pendingUnits(item);
  if (draft.quantity > pending) return "over";
  if (draft.closeRemaining && draft.quantity < pending) return "short";
  return null;
}

/**
 * Lines to send: anything that arrived, plus lines closed without another delivery.
 * The reason travels only when there is a difference to explain.
 */
export function buildReceiveLines(items: PurchaseItem[], drafts: Record<string, ReceiveDraft>) {
  const lines: ReceiveLine[] = [];
  let missingReason = false;
  for (const item of openLines(items)) {
    const draft = drafts[item.id];
    if (!draft) continue;
    const difference = receiveDifference(item, draft);
    if (draft.quantity <= 0 && difference !== "short") continue;
    const reason = draft.reason.trim();
    if (difference && !reason) missingReason = true;
    lines.push({
      item_id: item.id,
      quantity: Math.max(0, draft.quantity),
      ...(difference === "short" ? { close_remaining: true as const } : {}),
      ...(difference ? { difference_reason: reason } : {}),
    });
  }
  return { lines, missingReason };
}
