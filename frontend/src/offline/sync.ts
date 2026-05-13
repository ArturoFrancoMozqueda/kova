import type { Order } from "../orders/types";
import {
  markOfflineSaleFailed,
  markOfflineSaleStatus,
  markOfflineSaleSynced,
} from "./queue";
import type { OfflineSaleQueueItem } from "./types";

type ApiSyncResult = {
  client_uuid: string;
  status: "synced" | "failed";
  order_id: string | null;
  order: Order | null;
  error: string | null;
};

export type SyncItemResult = {
  client_uuid: string;
  status: "synced" | "failed";
  order_id: string | null;
  order: Order | null;
  error: string | null;
};

export async function syncOfflineSales(items: OfflineSaleQueueItem[]): Promise<SyncItemResult[]> {
  for (const item of items) {
    await markOfflineSaleStatus(item.client_uuid, "syncing");
  }

  let apiResults: ApiSyncResult[];

  try {
    const response = await fetch("/api/v1/sync/offline-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sales: items.map((item) => ({
          client_uuid: item.client_uuid,
          order: item.sale,
        })),
      }),
    });

    if (!response.ok) {
      const message = `Sync failed with status ${response.status}`;
      await Promise.all(items.map((item) => markOfflineSaleFailed(item.client_uuid, message)));
      return items.map((item) => ({
        client_uuid: item.client_uuid,
        status: "failed" as const,
        order_id: null,
        order: null,
        error: message,
      }));
    }

    const body = (await response.json()) as { results: ApiSyncResult[] };
    apiResults = body.results;
  } catch (err) {
    // Network error — mark back to pending so sync worker can retry
    for (const item of items) {
      await markOfflineSaleStatus(item.client_uuid, "pending");
    }
    throw err;
  }

  const results: SyncItemResult[] = [];
  for (const result of apiResults) {
    if (result.status === "synced") {
      await markOfflineSaleSynced(result.client_uuid, result.order_id ?? undefined);
      results.push({ ...result, status: "synced" });
    } else {
      await markOfflineSaleFailed(result.client_uuid, result.error ?? "Sync failed");
      results.push({ ...result, status: "failed", order_id: null, order: null });
    }
  }
  return results;
}
