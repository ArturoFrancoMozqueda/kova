import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorStatus } from "@/lib/apiError";
import { useAuth } from "@/auth/useAuth";
import { listStock, listVelocity } from "../../inventory/api";
import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import { getBusinessStory, getSalesByHour, invalidateReportsCache } from "../api";
import type { BusinessStoryReport, SalesByHourRow } from "../types";
import { addDays, daysBetweenInclusive, isValidDateRange, previousComparableRange } from "../utils/dateRange";

export type ReportPending = Record<"previous" | "hourly" | "trend" | "stock" | "velocity", boolean>;
export type ReportDataState = {
  status: "loading" | "error" | "subscription-inactive" | "loaded";
  story: BusinessStoryReport | null;
  previousStory: BusinessStoryReport | null;
  previousFailed: boolean;
  hourly: SalesByHourRow[];
  hourlyFailed: boolean;
  trendStory: BusinessStoryReport | null;
  stock: StockItem[];
  velocity: InventoryVelocityItem[];
  stockFailed: boolean;
  velocityFailed: boolean;
  pending: ReportPending;
  reload: () => void;
};

type Snapshot = Omit<ReportDataState, "reload"> & { requestKey: string };
function emptySnapshot(requestKey: string): Snapshot {
  return {
    requestKey, status: "loading", story: null, previousStory: null, previousFailed: false,
    hourly: [], hourlyFailed: false, trendStory: null, stock: [], velocity: [],
    stockFailed: false, velocityFailed: false,
    pending: { previous: true, hourly: true, trend: true, stock: true, velocity: true },
  };
}

/** The primary story owns billing/error acceptance. Independent reads reveal
 * their own sections as they settle, never treating a pending read as empty. */
export function useReportData(startDate: string, endDate: string, enabled: boolean): ReportDataState {
  const { state: auth } = useAuth();
  const identityKey = auth.status === "authenticated"
    ? JSON.stringify([auth.tenantId, auth.user.id, auth.user.role, auth.sessionMode]) : null;
  const requestKey = JSON.stringify([identityKey, startDate, endDate, enabled]);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<Snapshot>(() => emptySnapshot(requestKey));

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!enabled || !identityKey || (!startDate && !endDate)) return;
    if (!isValidDateRange(startDate, endDate)) {
      setState({ ...emptySnapshot(requestKey), status: "error" });
      return;
    }
    const previousRange = previousComparableRange(startDate, endDate);
    const singleDay = daysBetweenInclusive(startDate, endDate) === 1;
    const initial = emptySnapshot(requestKey);
    initial.pending.trend = singleDay;
    setState(initial);
    const commit = (update: (current: Snapshot) => Snapshot) => {
      if (requestId !== requestIdRef.current) return;
      setState(current => requestId === requestIdRef.current && current.requestKey === requestKey
        ? update(current) : current);
    };
    const secondary = <T,>(
      promise: Promise<T>, key: keyof ReportPending,
      success: (value: T) => Partial<Snapshot>, failure: Partial<Snapshot>,
    ) => promise.then(
      value => commit(current => ({ ...current, ...success(value), pending: { ...current.pending, [key]: false } })),
      () => commit(current => ({ ...current, ...failure, pending: { ...current.pending, [key]: false } })),
    );
    // Start together; awaiting the group only owns this operation's lifetime,
    // not the visibility of the primary story or any completed section.
    await Promise.all([
      getBusinessStory(startDate, endDate).then(
        story => commit(current => ({ ...current, story, status: "loaded" })),
        error => commit(current => ({ ...current, story: null,
          status: apiErrorStatus(error) === 402 ? "subscription-inactive" : "error" })),
      ),
      secondary(getSalesByHour(startDate, endDate), "hourly", hourly => ({ hourly }), { hourlyFailed: true }),
      secondary(getBusinessStory(previousRange.startDate, previousRange.endDate), "previous",
        previousStory => ({ previousStory }), { previousFailed: true }),
      secondary(listStock(), "stock", stock => ({ stock }), { stockFailed: true }),
      secondary(listVelocity(), "velocity", velocity => ({ velocity }), { velocityFailed: true }),
      singleDay ? secondary(getBusinessStory(addDays(endDate, -6), endDate), "trend",
        trendStory => ({ trendStory }), {}) : Promise.resolve(),
    ]);
  }, [enabled, identityKey, requestKey, startDate, endDate]);

  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  // Hide every dataset synchronously on identity/range changes, before effects.
  return { ...(state.requestKey === requestKey ? state : emptySnapshot(requestKey)), reload: () => {
    invalidateReportsCache();
    void load();
  } };
}
