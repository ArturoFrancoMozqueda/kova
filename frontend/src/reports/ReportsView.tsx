import { Link } from "react-router-dom";
import { BranchComparison } from "@/branches/BranchComparison";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useTenantTimezone } from "@/hooks/useTenantTimezone";
import { useFeature } from "@/auth/useFeature";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { todayInTimezone } from "@/i18n/date";
import { copy } from "@/i18n/messages";
import { ViewLayout } from "@/components/ui/view-layout";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { SubscriptionInactivePanel } from "@/billing/SubscriptionInactivePanel";
import { REPORTS_VIEW_ALL_PERMISSION, usePermission } from "../auth/permissions";
import type { InventoryVelocityItem, StockItem } from "../inventory/types";
import type { RestockHorizon } from "../inventory/restockPlan";
import { AnalysisOverview } from "./components/AnalysisOverview";
import { ActionPlanSection } from "./components/ActionPlanSection";
import { EmployeePerformance } from "./components/EmployeePerformance";
import { MarginAnalysis } from "./components/MarginAnalysis";
import { OperatingExpenseAnalysis } from "./components/OperatingExpenseAnalysis";
import { WasteAnalysis } from "./components/WasteAnalysis";
import { ProductTableSection } from "./components/ProductInventoryAnalysis";
import { RefundsAndCancellations } from "./components/RefundsAndCancellations";
import { ReportsHeader } from "./components/ReportsHeader";
import { RestockPlan } from "./components/RestockPlan";
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
import { activePreset, daysBetweenInclusive, isValidDateRange, presetRange, type ReportPreset } from "./utils/dateRange";
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
  inventoryAvailable: boolean,
) {
  return buildRecommendations({
    story,
    previousStory,
    trackedIds: new Set(stock.map((item) => item.product_id)),
    stockByProduct: new Map(stock.map((item) => [item.product_id, item])),
    velocityByProduct: new Map(velocity.map((item) => [item.product_id, item])),
    rangeDays: daysBetweenInclusive(story.summary.start_date, story.summary.end_date),
    inventoryAvailable,
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
  const [comparisonRefresh, setComparisonRefresh] = useState(0);
  const [restockHorizon, setRestockHorizon] = useState<RestockHorizon>(7);

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
  const reloadReports = () => { data.reload(); setComparisonRefresh((value) => value + 1); };
  const { doneIds, feedbackById, toggleDone, setFeedback, clearFeedback } = usePlanDoneState(
    data.story ?? null,
  );

  // Recommendations + action plan build Sets/Maps over stock, velocity and the
  // full story; memoized so typing in the date inputs (or any unrelated state
  // change) doesn't recompute them. Hoisted above the permission early-return
  // to keep hook order unconditional.
  const planPending = data.pending.previous || data.pending.stock || data.pending.velocity;
  const inventoryPending = data.pending.stock || data.pending.velocity;
  const plan = useMemo(() => {
    const story = data.story;
    if (data.status !== "loaded" || planPending || !story || story.summary.completed_orders === 0) {
      return null;
    }
    return buildActionPlan({
      recommendations: recommendationsFor(story, data.previousStory, data.stock, data.velocity, !data.stockFailed),
      story,
      previousStory: data.previousStory,
    });
  }, [data.status, data.story, data.previousStory, data.stock, data.velocity, data.stockFailed, planPending]);

  const trackedAnalysisKey = useRef("");
  useEffect(() => {
    const story = data.story;
    if (data.status !== "loaded" || planPending || !story || story.summary.completed_orders === 0) return;
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
  }, [data.status, data.story, data.previousStory, plan, planPending, tz]);

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
    if (!isValidDateRange(startDate, endDate)) return;
    if (startDate === appliedRange.startDate && endDate === appliedRange.endDate) {
      reloadReports();
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
        appliedRange={appliedRange}
        timezone={story?.summary.timezone}
        activePreset={activePreset(appliedRange.startDate, appliedRange.endDate, tz)}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onSubmit={submit}
        onPreset={applyPreset}
      />

      <nav aria-label="Secciones de análisis" className="flex flex-wrap items-center gap-1 border-b border-kova-border pb-2 text-sm">
        <Link to="/dashboard" className="mr-auto inline-flex min-h-11 items-center rounded-kova-md px-3 font-medium text-kova-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">← Volver al panel</Link>
        {(loaded ? [...(hasSales && marginReportsEnabled ? [["rentabilidad", "Rentabilidad"]] : []), ["productos-reposicion", "Productos y reposición"], ...(hasSales ? [["operacion", "Operación"], ["plan-accion", "Plan de acción"]] : [])] : []).map(([id, label]) => <a key={id} href={`#analisis-${id}`} className="inline-flex min-h-11 items-center rounded-kova-md px-3 text-kova-muted hover:bg-kova-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue">{label}</a>)}
      </nav>

      {data.status !== "subscription-inactive" ? <BranchComparison startDate={appliedRange.startDate} endDate={appliedRange.endDate} refreshKey={comparisonRefresh} /> : null}

      {data.status === "loading" ? <LoadingState /> : null}
      {data.status === "error" ? <ErrorState onRetry={reloadReports} /> : null}
      {data.status === "subscription-inactive" ? <SubscriptionInactivePanel /> : null}

      {loaded && !hasSales ? <section id="analisis-productos-reposicion">
        {inventoryPending ? <SectionSkeleton label="Cargando reposición" /> : <RestockPlan stock={data.stock} velocity={data.velocity} stockFailed={data.stockFailed} velocityFailed={data.velocityFailed} horizon={restockHorizon} onHorizonChange={setRestockHorizon} onRetry={reloadReports} />}
      </section> : null}
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
            previousPending={data.pending.previous}
            hourlyPending={data.pending.hourly}
            trendPending={data.pending.trend}
            priorityPending={planPending}
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

          {marginReportsEnabled && <section id="analisis-rentabilidad" aria-label="Rentabilidad a detalle" className="scroll-mt-4 space-y-4">
            <MarginAnalysis story={story} />
            <WasteAnalysis story={story} />
            <OperatingExpenseAnalysis story={story} />
          </section>}

          {/* Deeper operational reading remains below the compact overview. */}
          <div id="analisis-operacion" className="grid scroll-mt-4 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.pending.previous ? <SectionSkeleton label="Cargando comparación por horario" /> : <DaypartsPanel story={story} previousStory={data.previousStory} />}
            <RefundsAndCancellations story={story} />
            <EmployeePerformance story={story} />
          </div>

          <section id="analisis-productos-reposicion" aria-label="Productos y reposición a detalle" className="scroll-mt-4 space-y-4">
            {inventoryPending ? <SectionSkeleton label="Cargando reposición" /> : <RestockPlan stock={data.stock} velocity={data.velocity}
              stockFailed={data.stockFailed} velocityFailed={data.velocityFailed}
              horizon={restockHorizon} onHorizonChange={setRestockHorizon} onRetry={reloadReports} />}
            {inventoryPending ? <SectionSkeleton label="Cargando inventario de productos" /> : <ProductTableSection story={story} stock={data.stock} velocity={data.velocity}
              inventoryAvailable={!data.stockFailed} />}
          </section>

          <section id="analisis-plan-accion" aria-label="Plan de acción a detalle" className="scroll-mt-4">
            {planPending ? <SectionSkeleton label="Preparando plan de acción" /> : <ActionPlanSection
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
            />}
          </section>
        </div>
      ) : null}
    </ViewLayout>
  );
}
