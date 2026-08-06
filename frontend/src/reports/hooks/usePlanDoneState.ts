import { useEffect, useState } from "react";

import { useAuth } from "@/auth/useAuth";
import type { AnalysisHelpfulness } from "@/telemetry/funnel";
import type { BusinessStoryReport } from "../types";

function readDoneIds(storageKey: string, legacyStorageKey?: string): Set<string> {
  try {
    const raw =
      window.localStorage.getItem(storageKey) ??
      (legacyStorageKey ? window.localStorage.getItem(legacyStorageKey) : null);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function readFeedback(storageKey: string): Record<string, AnalysisHelpfulness> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, AnalysisHelpfulness] =>
          entry[1] === "helpful" || entry[1] === "not_yet",
      ),
    );
  } catch {
    return {};
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
  const legacyStorageKey = `kova:plan:${tenantId}:${startDate}:${endDate}`;
  const storageKey = `kova:plan:v2:${tenantId}:${startDate}:${endDate}`;
  const feedbackStorageKey = `${storageKey}:feedback`;

  const [doneIds, setDoneIds] = useState<Set<string>>(() =>
    readDoneIds(storageKey, legacyStorageKey),
  );
  const [feedbackById, setFeedbackById] = useState<Record<string, AnalysisHelpfulness>>(
    () => readFeedback(feedbackStorageKey),
  );
  useEffect(() => {
    const restored = readDoneIds(storageKey, legacyStorageKey);
    setDoneIds(restored);
    try {
      if (!window.localStorage.getItem(storageKey) && restored.size > 0) {
        window.localStorage.setItem(storageKey, JSON.stringify([...restored]));
      }
    } catch {
      /* storage migration is best effort */
    }
    setFeedbackById(readFeedback(feedbackStorageKey));
  }, [feedbackStorageKey, legacyStorageKey, storageKey]);

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

  const setFeedback = (id: string, feedback: AnalysisHelpfulness) => {
    setFeedbackById((previous) => {
      const next = { ...previous, [id]: feedback };
      try {
        window.localStorage.setItem(feedbackStorageKey, JSON.stringify(next));
      } catch {
        /* quota/denied: feedback remains available for the session */
      }
      return next;
    });
  };

  const clearFeedback = (id: string) => {
    setFeedbackById((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      try {
        window.localStorage.setItem(feedbackStorageKey, JSON.stringify(next));
      } catch {
        /* quota/denied: feedback still clears for the session */
      }
      return next;
    });
  };

  return { doneIds, feedbackById, toggleDone, setFeedback, clearFeedback };
}
