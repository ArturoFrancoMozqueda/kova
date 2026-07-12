import { useCallback, useEffect, useState } from "react";

import { apiErrorStatus } from "@/lib/apiError";
import { listStock, listVelocity } from "../../inventory/api";
import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import { getBusinessStory, getSalesByHour } from "../api";
import type { BusinessStoryReport, SalesByHourRow } from "../types";
import { addDays, daysBetweenInclusive, previousComparableRange } from "../utils/dateRange";

export type ReportDataState = {
  status: "loading" | "error" | "subscription-inactive" | "loaded";
  story: BusinessStoryReport | null;
  /** Previous comparable period, or null when it failed / had no sales. */
  previousStory: BusinessStoryReport | null;
  /** True when the previous-period fetch rejected (distinct from "no sales"). */
  previousFailed: boolean;
  hourly: SalesByHourRow[];
  /** True when the hourly fetch rejected (surface a note instead of empty). */
  hourlyFailed: boolean;
  /** Trailing 7-day story fetched only for single-day ranges, so the daily
   * sales chart never disappears when the owner lands on "Hoy". */
  trendStory: BusinessStoryReport | null;
  stock: StockItem[];
  velocity: InventoryVelocityItem[];
  reload: () => void;
};

/**
 * Loads the business story plus its supporting datasets. The primary story
 * failing is a hard error; secondary datasets (hourly, previous period,
 * inventory) degrade individually and surface their own notice rather than
 * silently rendering as empty.
 *
 * `stock` comes from `listStock` (all tracked products) rather than
 * `listLowStock`, so the view can tell "untracked" apart from "zero on hand".
 */
export function useReportData(startDate: string, endDate: string, enabled: boolean): ReportDataState {
  const [state, setState] = useState<Omit<ReportDataState, "reload">>({
    status: "loading",
    story: null,
    previousStory: null,
    previousFailed: false,
    hourly: [],
    hourlyFailed: false,
    trendStory: null,
    stock: [],
    velocity: [],
  });

  const load = useCallback(async () => {
    if (!enabled || !startDate || !endDate) return;
    setState((prev) => ({ ...prev, status: "loading" }));
    try {
      // These endpoints never resolve to null on success, so a null result
      // unambiguously signals that the individual fetch was caught and failed.
      const [story, hourly] = await Promise.all([
        getBusinessStory(startDate, endDate),
        getSalesByHour(startDate, endDate).catch(() => null),
      ]);
      const previousRange = previousComparableRange(startDate, endDate);
      const singleDay = daysBetweenInclusive(startDate, endDate) === 1;
      const [previous, stock, velocity, trend] = await Promise.all([
        getBusinessStory(previousRange.startDate, previousRange.endDate).catch(() => null),
        listStock().catch(() => null),
        listVelocity().catch(() => null),
        singleDay
          ? getBusinessStory(addDays(endDate, -6), endDate).catch(() => null)
          : Promise.resolve(null),
      ]);
      setState({
        status: "loaded",
        story,
        previousStory: previous,
        previousFailed: previous === null,
        hourly: hourly ?? [],
        hourlyFailed: hourly === null,
        trendStory: trend,
        stock: stock ?? [],
        velocity: velocity ?? [],
      });
    } catch (err) {
      // A 402 on the primary story means the plan is inactive — a dead-end that
      // retrying won't fix, so surface the "activate plan" state instead of the
      // generic retry error.
      setState((prev) => ({
        ...prev,
        status: apiErrorStatus(err) === 402 ? "subscription-inactive" : "error",
      }));
    }
  }, [enabled, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: () => void load() };
}
