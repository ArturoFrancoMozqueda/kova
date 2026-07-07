import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
import { formatMoney, reasonLabel } from "@/orders/format";
import { cn } from "@/lib/utils";
import type { BusinessStoryReport } from "../types";
import {
  type OpsSeverity as Severity,
  cancelRatePct,
  cancelSeverityLevel,
  refundRatePct,
  refundSeverityLevel,
} from "../utils/calculations";
import { ReportSection } from "./ReportSection";

const SEVERITY_TEXT: Record<Severity, string> = {
  info: "text-kova-muted",
  watch: "text-warning-foreground",
  high: "text-destructive",
};

// Threshold logic lives in utils/calculations (shared with the action plan);
// only the message wording is chosen here.
function refundSeverity(rate: number, count: number): { tone: Severity; message: string } {
  const tone = refundSeverityLevel(rate, count);
  if (tone === "info") {
    return {
      tone,
      message: count <= 1 && rate < 5 ? copy.reportsView.refundSingleGuard : copy.reportsView.refundRateNormal,
    };
  }
  return {
    tone,
    message: tone === "watch" ? copy.reportsView.refundRateWatch : copy.reportsView.refundRateHigh,
  };
}

function cancelSeverity(rate: number, count: number): { tone: Severity; message: string } {
  const tone = cancelSeverityLevel(rate, count);
  const message =
    tone === "info"
      ? copy.reportsView.cancelNormal
      : tone === "watch"
        ? copy.reportsView.cancelWatch
        : copy.reportsView.cancelHigh;
  return { tone, message };
}

function Tile({
  label,
  value,
  valueTone,
  subValue,
  note,
}: {
  label: string;
  value: string;
  valueTone?: Severity;
  subValue?: string;
  note?: string;
}) {
  return (
    <div className="rounded-kova-lg border border-kova-border bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">{label}</p>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", valueTone ? SEVERITY_TEXT[valueTone] : "text-kova-ink")}>
        {value}
      </p>
      {subValue ? <p className="text-xs text-kova-muted">{subValue}</p> : null}
      {note ? <p className={cn("mt-1 text-xs", valueTone ? SEVERITY_TEXT[valueTone] : "text-kova-muted")}>{note}</p> : null}
    </div>
  );
}

export function RefundsAndCancellations({ story }: { story: BusinessStoryReport }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const summary = story.summary;
  const refundCount = summary.refund_count;
  const cancelCount = summary.cancellation_count;

  if (refundCount === 0 && cancelCount === 0) {
    return (
      <ReportSection
        icon={<RotateCcw className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.refundsSectionTitle}
        description={copy.reportsView.refundsSectionDescription}
      >
        <p className="rounded-kova-md border border-kova-growth/30 bg-kova-growth/5 p-4 text-sm text-kova-ink">
          {copy.reportsView.refundsCleanState}
        </p>
      </ReportSection>
    );
  }

  const refundRate = refundRatePct(summary);
  const cancelRate = cancelRatePct(summary);
  const refund = refundSeverity(refundRate, refundCount);
  const cancel = cancelSeverity(cancelRate, cancelCount);

  const reasons = [...story.refunds_by_reason].sort(
    (a, b) => Number(b.refunded_amount) - Number(a.refunded_amount),
  );
  const refundTotal = Number(summary.refund_total);
  const topReasons = reasons.slice(0, 6);
  const rest = reasons.slice(6);
  const restAmount = rest.reduce((sum, row) => sum + Number(row.refunded_amount), 0);
  const restCount = rest.reduce((sum, row) => sum + row.refund_count, 0);

  // Calm operation (both signals at "info"): one status line, detail one tap
  // away. The tiles and table only open by default when something needs eyes.
  const calm = refund.tone === "info" && cancel.tone === "info";
  if (calm && !detailOpen) {
    return (
      <ReportSection
        icon={<RotateCcw className="h-5 w-5 text-muted-foreground" />}
        title={copy.reportsView.refundsSectionTitle}
        description={copy.reportsView.refundsSectionDescription}
      >
        <p className="rounded-kova-md border border-kova-growth/30 bg-kova-growth/5 p-4 text-sm text-kova-ink">
          {copy.reportsView.refundsCalmSummary(
            copy.reportsView.refundCountValue(refundCount),
            formatMoney(summary.refund_total),
            copy.reportsView.cancelCountValue(cancelCount),
          )}
        </p>
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setDetailOpen(true)}>
            {copy.reportsView.refundsShowDetail}
          </Button>
        </div>
      </ReportSection>
    );
  }

  return (
    <ReportSection
      icon={<RotateCcw className="h-5 w-5 text-muted-foreground" />}
      title={copy.reportsView.refundsSectionTitle}
      description={copy.reportsView.refundsSectionDescription}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile
          label={copy.reportsView.refundsTileRefunds}
          value={String(refundCount)}
          subValue={formatMoney(summary.refund_total)}
        />
        <Tile label={copy.reportsView.refundsTileCancellations} value={String(cancelCount)} note={cancel.message} valueTone={cancel.tone} />
        <Tile
          label={copy.reportsView.refundsTileRate}
          value={`${Math.round(refundRate)}%`}
          valueTone={refund.tone}
          note={refund.message}
        />
      </div>

      {topReasons.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-kova-md border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">{copy.reportsView.refundReasonColumn}</th>
                <th className="px-4 py-2.5 font-medium">{copy.reportsView.refundCountColumn}</th>
                <th className="px-4 py-2.5 font-medium">{copy.reportsView.refundAmountColumn}</th>
                <th className="px-4 py-2.5 font-medium">{copy.reportsView.refundShareColumn}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {topReasons.map((row, index) => (
                <tr key={row.reason} className={cn(index === 0 && "bg-kova-mist/40")}>
                  <td className="px-4 py-2.5 font-medium">{reasonLabel(row.reason)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.refund_count}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatMoney(row.refunded_amount)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                    {refundTotal > 0 ? Math.round((Number(row.refunded_amount) / refundTotal) * 100) : 0}%
                  </td>
                </tr>
              ))}
              {rest.length > 0 ? (
                <tr className="text-muted-foreground">
                  <td className="px-4 py-2.5">{copy.reportsView.refundOther}</td>
                  <td className="px-4 py-2.5 tabular-nums">{restCount}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatMoney(String(restAmount))}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {refundTotal > 0 ? Math.round((restAmount / refundTotal) * 100) : 0}%
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {reasons.length === 1 ? (
        <p className="mt-2 text-xs text-muted-foreground">{copy.reportsView.refundReasonHint}</p>
      ) : null}
      {calm ? (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setDetailOpen(false)}>
            {copy.reportsView.refundsHideDetail}
          </Button>
        </div>
      ) : null}
    </ReportSection>
  );
}
