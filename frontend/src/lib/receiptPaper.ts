export type ReceiptPaperWidth = 58 | 80;

export const DEFAULT_RECEIPT_PAPER_WIDTH: ReceiptPaperWidth = 80;

const storageKey = (tenantId: string) => `kova-receipt-paper-width:${tenantId}`;

export function normalizeReceiptPaperWidth(value: unknown): ReceiptPaperWidth {
  return value === 58 || value === "58" ? 58 : DEFAULT_RECEIPT_PAPER_WIDTH;
}

export function readCachedReceiptPaperWidth(tenantId: string): ReceiptPaperWidth {
  if (!tenantId || typeof window === "undefined") return DEFAULT_RECEIPT_PAPER_WIDTH;
  try {
    return normalizeReceiptPaperWidth(window.localStorage.getItem(storageKey(tenantId)));
  } catch {
    return DEFAULT_RECEIPT_PAPER_WIDTH;
  }
}

export function cacheReceiptPaperWidth(tenantId: string, width: ReceiptPaperWidth): void {
  if (!tenantId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tenantId), String(width));
  } catch {
    // Storage can be unavailable in private browsing. Printing still falls
    // back safely to 80 mm and the server remains the source of truth.
  }
}
