import { type FormEvent, useEffect, useRef, useState } from "react";

import { useTenantTimezone } from "@/hooks/useTenantTimezone";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { todayInTimezone } from "@/i18n/date";
import { copy } from "@/i18n/messages";
import { ArcKicker } from "@/components/ui/arc-kicker";
import { SubscriptionInactivePanel } from "@/billing/SubscriptionInactivePanel";
import { REPORTS_VIEW_ALL_PERMISSION, usePermission } from "../auth/permissions";
import type { InventoryVelocityItem, StockItem } from "../inventory/types";
import { ExecutiveSummary, QuickFacts } from "./components/ExecutiveSummary";
import { ActionPlanSection } from "./components/ActionPlanSection";
import { EmployeePerformance } from "./components/EmployeePerformance";
import { PaymentAnalysis } from "./components/PaymentAnalysis";
import { PriorityActionCard } from "./components/PriorityActionCard";
import { ProductInventoryAnalysis } from "./components/ProductInventoryAnalysis";
import { RefundsAndCancellations } from "./components/RefundsAndCancellations";
import { ReportsHeader } from "./components/ReportsHeader";
import {
  EmptyBusinessState,
  ErrorState,
  LoadingState,
  PermissionDenied,
} from "./components/ReportStates";
import { TimingAnalysis } from "./components/TimingAnalysis";
import { usePlanDoneState } from "./hooks/usePlanDoneState";
import { useReportData } from "./hooks/useReportData";
import type { BusinessStoryReport } from "./types";
import { buildActionPlan } from "./utils/actionPlan";
import { activePreset, daysBetweenInclusive, presetRange, type ReportPreset } from "./utils/dateRange";
import { buildRecommendations } from "./utils/recommendations";

const CHAPTERS = [
  { id: "reporte-resumen", label: copy.reportsView.navSummary },
  { id: "reporte-plan", label: copy.reportsView.navPlan },
  { id: "reporte-porque", label: copy.reportsView.navWhy },
  { id: "reporte-control", label: copy.reportsView.navOps },
];

/** Phone-only sticky chapter chips: one tap to any act of the story, so the
 * 6+ scroll screens never mean hunting for a section. */
function ChapterNav() {
  return (
    <nav
      aria-label={copy.reportsView.navAria}
      className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-kova-border bg-background/95 px-4 py-2 backdrop-blur sm:hidden"
    >
      {CHAPTERS.map((chapter) => (
        <button
          key={chapter.id}
          type="button"
          onClick={() =>
            document.getElementById(chapter.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="shrink-0 rounded-full border border-kova-border bg-white px-3 py-1 text-xs font-medium text-kova-ink"
        >
          {chapter.label}
        </button>
      ))}
    </nav>
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
  const [appliedRange, setAppliedRange] = useState({ startDate: "", endDate: "" });

  // Seed the range to "today in the tenant timezone" once the timezone
  // resolves, so operators outside CDMX don't start on the wrong day.
  const rangeSeeded = useRef(false);
  useEffect(() => {
    if (rangeSeeded.current || !tzResolved) return;
    rangeSeeded.current = true;
    const today = todayInTimezone(tz);
    setStartDate(today);
    setEndDate(today);
    setAppliedRange({ startDate: today, endDate: today });
  }, [tz, tzResolved]);

  const data = useReportData(appliedRange.startDate, appliedRange.endDate, canViewReports);
  const { doneIds, toggleDone } = usePlanDoneState(data.story ?? null);

  const setToday = () => {
    const today = todayInTimezone(tz);
    setStartDate(today);
    setEndDate(today);
    setAppliedRange({ startDate: today, endDate: today });
  };

  const applyPreset = (preset: ReportPreset) => {
    const range = presetRange(preset, tz);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setAppliedRange(range);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (startDate === appliedRange.startDate && endDate === appliedRange.endDate) {
      data.reload();
      return;
    }
    setAppliedRange({ startDate, endDate });
  };

  if (!canViewReports) {
    return <PermissionDenied />;
  }

  const loaded = data.status === "loaded" && data.story;
  const hasSales = loaded && data.story!.summary.completed_orders > 0;
  const story = data.story;

  const plan =
    hasSales && story
      ? buildActionPlan({
          recommendations: recommendationsFor(story, data.previousStory, data.stock, data.velocity),
          story,
          previousStory: data.previousStory,
        })
      : null;
  const heroId = plan?.hero ? `${plan.hero.id}|${plan.hero.subjectId}` : null;

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
      {data.status === "subscription-inactive" ? <SubscriptionInactivePanel /> : null}

      {loaded && !hasSales ? <EmptyBusinessState onPickToday={setToday} /> : null}

      {hasSales && story ? (
        <div className="space-y-4 sm:space-y-6">
          <ChapterNav />
          <div id="reporte-resumen" className="scroll-mt-14">
            <ExecutiveSummary
              story={story}
              previousStory={data.previousStory}
              previousFailed={data.previousFailed}
              rangeDays={daysBetweenInclusive(story.summary.start_date, story.summary.end_date)}
            />
          </div>
          <div id="reporte-plan" className="scroll-mt-14">
            <PriorityActionCard
              recommendation={plan?.hero ?? null}
              done={heroId !== null && doneIds.has(heroId)}
              onToggleDone={() => heroId && toggleDone(heroId)}
            />
          </div>
          <QuickFacts story={story} />
          <ArcKicker id="reporte-porque" label={copy.reportsView.arcWhy} />
          <TimingAnalysis
            story={story}
            hourly={data.hourly}
            hourlyFailed={data.hourlyFailed}
            previousStory={data.previousStory}
            trendStory={data.trendStory}
          />
          <ProductInventoryAnalysis story={story} stock={data.stock} velocity={data.velocity} />
          <PaymentAnalysis story={story} previousStory={data.previousStory} />
          <ArcKicker id="reporte-control" label={copy.reportsView.arcOps} />
          <RefundsAndCancellations story={story} />
          <EmployeePerformance story={story} />
          <ActionPlanSection
            actions={plan?.actions ?? []}
            signals={plan?.signals ?? []}
            doneIds={doneIds}
            onToggleDone={toggleDone}
          />
        </div>
      ) : null}
    </main>
  );
}
