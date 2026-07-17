import { useEffect, useState } from "react";

import { useAuth } from "@/auth/useAuth";
import type { BusinessStoryReport } from "../types";

function readDoneIds(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Done-state of the action plan, persisted locally per tenant + period so the
 * plan feels alive between visits without touching the backend. Lifted to the
 * view level: the priority card and the full plan share one source of truth,
 * so toggles in one never clobber the other's writes.
 */
export function usePlanDoneState(story: BusinessStoryReport | null) {
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : "local";
  const startDate = story?.summary.start_date ?? "";
  const endDate = story?.summary.end_date ?? "";
  const storageKey = `kova:plan:${tenantId}:${startDate}:${endDate}`;

  const [doneIds, setDoneIds] = useState<Set<string>>(() => readDoneIds(storageKey));
  useEffect(() => {
    setDoneIds(readDoneIds(storageKey));
  }, [storageKey]);

  const toggleDone = (id: string) => {
    setDoneIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* quota/denied: the toggle still works for the session */
      }
      return next;
    });
  };

  return { doneIds, toggleDone };
}
