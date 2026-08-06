import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useTenantTimezone } from "@/hooks/useTenantTimezone";
import { useFeature } from "@/auth/useFeature";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { todayInTimezone } from "@/i18n/date";
import { copy } from "@/i18n/messages";
import { ViewLayout } from "@/components/ui/view-layout";
import { SubscriptionInactivePanel } from "@/billing/SubscriptionInactivePanel";
import { REPORTS_VIEW_ALL_PERMISSION, usePermission } from "../auth/permissions";
import type { InventoryVelocityItem, StockItem } from "../inventory/types";
import { AnalysisOverview } from "./components/AnalysisOverview";
import { ActionPlanSection } from "./components/ActionPlanSection";
import { EmployeePerformance } from "./components/EmployeePerformance";
import { MarginAnalysis } from "./components/MarginAnalysis";
import { OperatingExpenseAnalysis } from "./components/OperatingExpenseAnalysis";
import { WasteAnalysis } from "./components/WasteAnalysis";
import { ProductTableSection } from "./components/ProductInventoryAnalysis";
import { RefundsAndCancellations } from "./components/RefundsAndCancellations";
import { ReportsHeader } from "./components/ReportsHeader";
import {
  EmptyBusinessState,
  ErrorState,
  LoadingState,
  PermissionDenied,
} from "./components/ReportStates";
import { DaypartsPanel } from "./components/TimingAnalysis";
import { usePlanDoneState } from "./hooks/usePlanDoneState";
import { useReportData } from "./hooks/useReportData";
import type { BusinessStoryReport } from "./types";
import { buildActionPlan, recommendationDecisionArea } from "./utils/actionPlan";
import { activePreset, daysBetweenInclusive, presetRange, type ReportPreset } from "./utils/dateRange";
import { buildRecommendations } from "./utils/recommendations";
import {
  trackAnalysisActionState,
  trackAnalysisActionFeedback,
  trackAnalysisViewed,
  type AnalysisActionContext,
  type AnalysisHelpfulness,
} from "@/telemetry/funnel";

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
  const marginReportsEnabled = useFeature("margin_reports");
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
  const { doneIds, feedbackById, toggleDone, setFeedback, clearFeedback } = usePlanDoneState(
    data.story ?? null,
  );

  // Recommendations + action plan build Sets/Maps over stock, velocity and the
  // full story; memoized so typing in the date inputs (or any unrelated state
  // change) doesn't recompute them. Hoisted above the permission early-return
  // to keep hook order unconditional.
  const plan = useMemo(() => {
    const story = data.story;
    if (data.status !== "loaded" || !story || story.summary.completed_orders === 0) {
      return null;
    }
    return buildActionPlan({
      recommendations: recommendationsFor(story, data.previousStory, data.stock, data.velocity),
      story,
      previousStory: data.previousStory,
    });
  }, [data.status, data.story, data.previousStory, data.stock, data.velocity]);

  const trackedAnalysisKey = useRef("");
  useEffect(() => {
    const story = data.story;
    if (data.status !== "loaded" || !story || story.summary.completed_orders === 0) return;
    const key = `${story.summary.start_date}:${story.summary.end_date}:${story.summary.completed_orders}`;
    if (trackedAnalysisKey.current === key) return;
    trackedAnalysisKey.current = key;
    const preset = activePreset(
      story.summary.start_date,
      story.summary.end_date,
      tz,
    );
    void trackAnalysisViewed({
      range_days: daysBetweenInclusive(story.summary.start_date, story.summary.end_date),
      preset: preset ?? "custom",
      has_previous_period: data.previousStory !== null,
      recommendation_count:
        (plan?.hero ? 1 : 0) + (plan?.actions.length ?? 0),
    });
  }, [data.status, data.story, data.previousStory, plan, tz]);

  const toggleTrackedAction = (id: string, context: AnalysisActionContext) => {
    const completed = !doneIds.has(id);
    void trackAnalysisActionState(completed, context);
    if (!completed) clearFeedback(id);
    toggleDone(id);
  };

  const recordActionFeedback = (
    id: string,
    helpfulness: AnalysisHelpfulness,
    context: AnalysisActionContext,
  ) => {
    setFeedback(id, helpfulness);
    void trackAnalysisActionFeedback(helpfulness, context);
  };

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

  const heroId = plan?.hero ? `${plan.hero.id}|${plan.hero.subjectId}` : null;
  return (
    <ViewLayout width="wide" className="space-y-6">
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
        <div
          key={`${appliedRange.startDate}:${appliedRange.endDate}`}
          className="kv-report-stagger space-y-4 sm:space-y-6"
        >
          <AnalysisOverview
            story={story}
            previousStory={data.previousStory}
            previousFailed={data.previousFailed}
            trendStory={data.trendStory}
            hourly={data.hourly}
            hourlyFailed={data.hourlyFailed}
            priority={plan?.hero ?? null}
            priorityDone={heroId !== null && doneIds.has(heroId)}
            priorityFeedback={heroId ? feedbackById[heroId] : undefined}
            onTogglePriority={() => {
              if (!heroId || !plan?.hero) return;
              toggleTrackedAction(heroId, {
                template_id: plan.hero.id,
                decision_area: recommendationDecisionArea(plan.hero.id),
                priority: plan.hero.priority,
                surface: "prioridad",
              });
            }}
            onPriorityFeedback={(helpfulness) => {
              if (!heroId || !plan?.hero || plan.hero.tone === "good_signal") return;
              recordActionFeedback(heroId, helpfulness, {
                template_id: plan.hero.id,
                decision_area: recommendationDecisionArea(plan.hero.id),
                priority: plan.hero.priority,
                surface: "prioridad",
              });
            }}
          />

          {marginReportsEnabled ? <MarginAnalysis story={story} /> : null}
          {marginReportsEnabled ? <WasteAnalysis story={story} /> : null}
          {marginReportsEnabled ? <OperatingExpenseAnalysis story={story} /> : null}

          {/* Deeper operational reading remains below the compact overview. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DaypartsPanel story={story} previousStory={data.previousStory} />
            <RefundsAndCancellations story={story} />
            <EmployeePerformance story={story} />
          </div>

          <ProductTableSection story={story} stock={data.stock} velocity={data.velocity} />

          <ActionPlanSection
            actions={plan?.actions ?? []}
            signals={plan?.signals ?? []}
            doneIds={doneIds}
            feedbackById={feedbackById}
            onToggleDone={(item) => {
              if (!item.priority) return;
              toggleTrackedAction(item.id, {
                template_id: item.templateId,
                decision_area: item.decisionArea,
                priority: item.priority,
                surface: "plan",
              });
            }}
            onFeedback={(item, helpfulness) => {
              if (!item.priority) return;
              recordActionFeedback(item.id, helpfulness, {
                template_id: item.templateId,
                decision_area: item.decisionArea,
                priority: item.priority,
                surface: "plan",
              });
            }}
          />
        </div>
      ) : null}
    </ViewLayout>
  );
}
