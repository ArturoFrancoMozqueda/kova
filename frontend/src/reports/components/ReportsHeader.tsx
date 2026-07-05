import type { FormEvent } from "react";
import { Filter } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{copy.reportsView.storyEyebrow}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{copy.reportsView.title}</h1>
        </div>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={activePreset === preset ? "default" : "outline"}
                onClick={() => onPreset(preset)}
              >
                {copy.reportsView.presetLabel(preset)}
              </Button>
            ))}
          </div>
          <div className="min-w-[140px] flex-1 space-y-1.5">
            <Label htmlFor="report-start-date">{copy.reportsView.startDate}</Label>
            <Input
              id="report-start-date"
              type="date"
              value={startDate}
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
              onChange={(event) => onEndDateChange(event.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <Button type="submit" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            {copy.reportsView.apply}
          </Button>
        </form>
      </div>
      {timezone ? (
        <p className="text-xs text-muted-foreground">
          {copy.reportsView.timezone}: {timezoneLabel(timezone)}
        </p>
      ) : null}
    </div>
  );
}
