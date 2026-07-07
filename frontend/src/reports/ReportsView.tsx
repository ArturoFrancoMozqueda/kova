import { type FormEvent, useEffect, useRef, useState } from "react";

import { useTenantTimezone } from "@/hooks/useTenantTimezone";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { todayInTimezone } from "@/i18n/date";
import { copy } from "@/i18n/messages";
import { REPORTS_VIEW_ALL_PERMISSION, usePermission } from "../auth/permissions";
import type { InventoryVelocityItem, StockItem } from "../inventory/types";
import { ExecutiveSummary, QuickFacts } from "./components/ExecutiveSummary";
import { EmployeePerformance } from "./components/EmployeePerformance";
import { PaymentAnalysis } from "./components/PaymentAnalysis";
import { ProductInventoryAnalysis } from "./components/ProductInventoryAnalysis";
import { RecommendationCards } from "./components/RecommendationCards";
import { RefundsAndCancellations } from "./components/RefundsAndCancellations";
import { ReportsHeader } from "./components/ReportsHeader";
import {
  EmptyBusinessState,
  ErrorState,
  LoadingState,
  PermissionDenied,
} from "./components/ReportStates";
import { TimingAnalysis } from "./components/TimingAnalysis";
import { useReportData } from "./hooks/useReportData";
import type { BusinessStoryReport } from "./types";
import { activePreset, daysBetweenInclusive, presetRange, type ReportPreset } from "./utils/dateRange";
import { buildRecommendations } from "./utils/recommendations";

/** Narrative-arc divider: makes the story structure explicit between blocks
 * (Resumen → Qué hacer ahora → Por qué pasó → Operación y control). */
function ArcKicker({ label }: { label: string }) {
  return (
    <p className="pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-kova-tertiary">
      {label}
    </p>
  );
}

function recommendationsFor(
  story: BusinessStoryReport,
  previousStory: BusinessStoryReport | null,
  stock: StockItem[],
  velocity: InventoryVelocityItem[],
) {
  return buildRecommendations({
    story,
    previousStory,
    trackedIds: new Set(stock.map((item) => item.product_id)),
    stockByProduct: new Map(stock.map((item) => [item.product_id, item])),
    velocityByProduct: new Map(velocity.map((item) => [item.product_id, item])),
    rangeDays: daysBetweenInclusive(story.summary.start_date, story.summary.end_date),
  });
}

export default function ReportsView() {
  useDocumentTitle(copy.documentTitles.reports);
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const { timezone: tz, isResolved: tzResolved } = useTenantTimezone();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Seed the range to "today in the tenant timezone" once the timezone
  // resolves, so operators outside CDMX don't start on the wrong day.
  const rangeSeeded = useRef(false);
  useEffect(() => {
    if (rangeSeeded.current || !tzResolved) return;
    rangeSeeded.current = true;
    const today = todayInTimezone(tz);
    setStartDate(today);
    setEndDate(today);
  }, [tz, tzResolved]);

  const data = useReportData(startDate, endDate, canViewReports);

  const setToday = () => {
    const today = todayInTimezone(tz);
    setStartDate(today);
    setEndDate(today);
  };

  const applyPreset = (preset: ReportPreset) => {
    const range = presetRange(preset, tz);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    data.reload();
  };

  if (!canViewReports) {
    return <PermissionDenied />;
  }

  const loaded = data.status === "loaded" && data.story;
  const hasSales = loaded && data.story!.summary.completed_orders > 0;
  const story = data.story;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <ReportsHeader
        startDate={startDate}
        endDate={endDate}
        timezone={story?.summary.timezone}
        activePreset={activePreset(startDate, endDate, tz)}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onSubmit={submit}
        onPreset={applyPreset}
      />

      {data.status === "loading" ? <LoadingState /> : null}
      {data.status === "error" ? <ErrorState onRetry={data.reload} /> : null}

      {loaded && !hasSales ? <EmptyBusinessState onPickToday={setToday} /> : null}

      {hasSales && story ? (
        <div className="space-y-4 sm:space-y-6">
          <ExecutiveSummary
            story={story}
            previousStory={data.previousStory}
            previousFailed={data.previousFailed}
            rangeDays={daysBetweenInclusive(story.summary.start_date, story.summary.end_date)}
          />
          <RecommendationCards
            recommendations={recommendationsFor(story, data.previousStory, data.stock, data.velocity)}
            story={story}
            previousStory={data.previousStory}
          />
          <QuickFacts story={story} />
          <ArcKicker label={copy.reportsView.arcWhy} />
          <TimingAnalysis
            story={story}
            hourly={data.hourly}
            hourlyFailed={data.hourlyFailed}
            previousStory={data.previousStory}
          />
          <ProductInventoryAnalysis story={story} stock={data.stock} velocity={data.velocity} />
          <PaymentAnalysis story={story} previousStory={data.previousStory} />
          <ArcKicker label={copy.reportsView.arcOps} />
          <RefundsAndCancellations story={story} />
          <EmployeePerformance story={story} />
        </div>
      ) : null}
    </main>
  );
}
