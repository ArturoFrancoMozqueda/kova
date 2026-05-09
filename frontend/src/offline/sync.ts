import {
  markOfflineSaleFailed,
  markOfflineSaleStatus,
  markOfflineSaleSynced,
} from "./queue";
import type { OfflineSaleQueueItem } from "./types";

type SyncResult = {
  client_uuid: string;
  status: "synced" | "failed";
  error?: string;
};

export async function syncOfflineSales(items: OfflineSaleQueueItem[]) {
  for (const item of items) {
    await markOfflineSaleStatus(item.client_uuid, "syncing");
  }

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
    const message = `Sync failed with ${response.status}`;
    await Promise.all(items.map((item) => markOfflineSaleFailed(item.client_uuid, message)));
    return;
  }

  const body = (await response.json()) as { results: SyncResult[] };
  await Promise.all(
    body.results.map((result) =>
      result.status === "synced"
        ? markOfflineSaleSynced(result.client_uuid)
        : markOfflineSaleFailed(result.client_uuid, result.error ?? "Sync failed")
    )
  );
}
