import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { offlineDb } from "./db";
import { discardQuarantinedSales, retryDeadLetter } from "./queue";
import { triggerSync } from "./syncWorker";
import type { OfflineSaleQueueItem } from "./types";
import { useAuth } from "@/auth/useAuth";

const EMPTY_QUEUE = {
  tenantId: null as string | null,
  pendingCount: 0,
  failedEntries: [] as OfflineSaleQueueItem[],
  quarantinedCount: 0,
};

export function useSyncQueue(shiftId?: string) {
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : null;
  const [queueState, setQueueState] = useState(EMPTY_QUEUE);

  useEffect(() => {
    if (!tenantId) {
      setQueueState(EMPTY_QUEUE);
      return;
    }
    let cancelled = false;
    const updateState = (patch: Partial<Omit<typeof EMPTY_QUEUE, "tenantId">>) => {
      if (cancelled) return;
      setQueueState((current) => ({
        ...(current.tenantId === tenantId ? current : EMPTY_QUEUE),
        tenantId,
        ...patch,
      }));
    };
    const pendingSub = liveQuery(async () => {
      const entries = await offlineDb.offline_sales
        .where("[tenant_id+status]")
        .anyOf([[tenantId, "pending"], [tenantId, "syncing"]])
        .toArray() as OfflineSaleQueueItem[];
      return shiftId ? entries.filter((entry) => entry.shift_id === shiftId).length : entries.length;
    }).subscribe((count) => updateState({ pendingCount: count }));

    const failedSub = liveQuery(async () => {
      const entries = await offlineDb.offline_sales
        .where("[tenant_id+status]")
        .equals([tenantId, "failed"])
        .sortBy("updated_at") as OfflineSaleQueueItem[];
      return shiftId ? entries.filter((entry) => entry.shift_id === shiftId) : entries;
    }).subscribe((entries) => updateState({ failedEntries: entries }));

    // Legacy rows have no trustworthy tenant ownership. Show only their count
    // so the current login can ask for guided recovery without seeing payloads
    // or gaining a path that could sync/reassign them.
    const quarantinedSub = liveQuery(() =>
      offlineDb.offline_sales.where("status").equals("quarantined").count()
    ).subscribe((count) => updateState({ quarantinedCount: count }));

    const onOnline = () => void triggerSync(tenantId);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      pendingSub.unsubscribe();
      failedSub.unsubscribe();
      quarantinedSub.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [shiftId, tenantId]);

  // Effects and IndexedDB reads run after render. Hide the previous tenant's
  // snapshot immediately, including while the new subscriptions are pending.
  const visibleQueue = queueState.tenantId === tenantId ? queueState : EMPTY_QUEUE;
  return {
    pendingCount: visibleQueue.pendingCount,
    failedEntries: visibleQueue.failedEntries,
    quarantinedCount: visibleQueue.quarantinedCount,
    syncNow: () => tenantId ? triggerSync(tenantId) : Promise.resolve(),
    retryDeadLetter: (clientUuid: string) => tenantId
      ? retryDeadLetter(tenantId, clientUuid)
      : Promise.resolve(false),
    discardQuarantined: discardQuarantinedSales,
  };
}

export function useIsOnline() {
  const [isOnline, setIsOnline] = useState(
    typeof window !== "undefined" ? window.navigator.onLine : true,
  );
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return isOnline;
}
