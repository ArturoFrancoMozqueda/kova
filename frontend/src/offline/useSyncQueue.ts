import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { offlineDb } from "./db";
import { retryDeadLetter } from "./queue";
import { triggerSync } from "./syncWorker";
import type { OfflineSaleQueueItem } from "./types";
import { useAuth } from "@/auth/useAuth";

export function useSyncQueue() {
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : null;
  const [pendingCount, setPendingCount] = useState(0);
  const [failedEntries, setFailedEntries] = useState<OfflineSaleQueueItem[]>([]);

  useEffect(() => {
    if (!tenantId) {
      setPendingCount(0);
      setFailedEntries([]);
      return;
    }
    const pendingSub = liveQuery(() =>
      offlineDb.offline_sales
        .where("[tenant_id+status]")
        .anyOf([[tenantId, "pending"], [tenantId, "syncing"]])
        .count(),
    ).subscribe((count) => setPendingCount(count));

    const failedSub = liveQuery(() =>
      offlineDb.offline_sales
        .where("[tenant_id+status]")
        .equals([tenantId, "failed"])
        .sortBy("updated_at"),
    ).subscribe((entries) => setFailedEntries(entries as OfflineSaleQueueItem[]));

    const onOnline = () => void triggerSync(tenantId);
    window.addEventListener("online", onOnline);

    return () => {
      pendingSub.unsubscribe();
      failedSub.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [tenantId]);

  return {
    pendingCount,
    failedEntries,
    syncNow: () => tenantId ? triggerSync(tenantId) : Promise.resolve(),
    retryDeadLetter: (clientUuid: string) => tenantId
      ? retryDeadLetter(tenantId, clientUuid)
      : Promise.resolve(false),
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
