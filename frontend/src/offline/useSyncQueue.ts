import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { offlineDb } from "./db";
import { retryDeadLetter } from "./queue";
import { triggerSync } from "./syncWorker";
import type { OfflineSaleQueueItem } from "./types";

export function useSyncQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedEntries, setFailedEntries] = useState<OfflineSaleQueueItem[]>([]);

  useEffect(() => {
    const pendingSub = liveQuery(() =>
      offlineDb.offline_sales.where("status").anyOf(["pending", "syncing"]).count(),
    ).subscribe((count) => setPendingCount(count));

    const failedSub = liveQuery(() =>
      offlineDb.offline_sales.where("status").equals("failed").sortBy("updated_at"),
    ).subscribe((entries) => setFailedEntries(entries));

    return () => {
      pendingSub.unsubscribe();
      failedSub.unsubscribe();
    };
  }, []);

  return { pendingCount, failedEntries, syncNow: triggerSync, retryDeadLetter };
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
