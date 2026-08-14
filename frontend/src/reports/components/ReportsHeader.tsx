import { useState, type FormEvent } from "react";
import { CalendarDays, Filter } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { formatDayMonthLong } from "@/i18n/date";
import { timezoneLabel } from "@/i18n/timezones";
import type { ReportPreset } from "../utils/dateRange";

const PRESETS: ReportPreset[] = ["today", "seven_days", "month"];

export function ReportsHeader({
  startDate,
  endDate,
  timezone,
  activePreset,
  onStartDateChange,
  onEndDateChange,
  onSubmit,
  onPreset,
}: {
  startDate: string;
  endDate: string;
  timezone?: string;
  activePreset: ReportPreset | null;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPreset: (preset: ReportPreset) => void;
}) {
  // On phones the presets cover most reads; the manual range stays one tap
  // away so the first screen leads with data instead of a form.
  const [customOpen, setCustomOpen] = useState(false);
  const rangeLabel = startDate && endDate
    ? startDate === endDate
      ? formatDayMonthLong(startDate)
      : `Del ${formatDayMonthLong(startDate)} al ${formatDayMonthLong(endDate)}`
    : undefined;
  const meta = [rangeLabel, timezone ? timezoneLabel(timezone) : null].filter(Boolean).join(" · ");

  return (
    <ViewHeader
      title={copy.reportsView.title}
      meta={meta || undefined}
      actions={
        <form
          onSubmit={onSubmit}
          className="flex max-w-2xl flex-wrap items-end justify-end gap-2"
        >
          <SegmentedControl
            ariaLabel={copy.reportsView.periodLabel}
            options={PRESETS.map((preset) => ({
              value: preset,
              label: copy.reportsView.presetLabel(preset),
            }))}
            value={activePreset}
            onValueChange={onPreset}
            selectionMode="button"
          >
            <Button
              type="button"
              size="sm"
              variant={customOpen ? "secondary" : "outline"}
              className="h-10"
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((value) => !value)}
            >
              <CalendarDays className="mr-1.5 h-4 w-4" />
              {copy.reportsView.customRange}
            </Button>
          </SegmentedControl>
          <div
            className={cn(
              "basis-full flex-wrap items-end justify-end gap-2 rounded-kova-md border border-kova-border bg-white p-3 shadow-kova-card",
              customOpen ? "flex" : "hidden",
            )}
          >
            <div className="min-w-[140px] flex-1 space-y-1.5">
              <Label htmlFor="report-start-date">{copy.reportsView.startDate}</Label>
              <Input
                id="report-start-date"
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => onStartDateChange(event.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <div className="min-w-[140px] flex-1 space-y-1.5">
              <Label htmlFor="report-end-date">{copy.reportsView.endDate}</Label>
              <Input
                id="report-end-date"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => onEndDateChange(event.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <Button type="submit" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              {copy.reportsView.apply}
            </Button>
          </div>
        </form>
      }
    />
  );
}
