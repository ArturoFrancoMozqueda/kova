import { useState, type FormEvent } from "react";
import { CalendarDays, Filter } from "lucide-react";

import { copy } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { cn } from "@/lib/utils";
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

  return (
    <ViewHeader
      eyebrow={copy.reportsView.storyEyebrow}
      title={copy.reportsView.title}
      meta={timezone ? `${copy.reportsView.timezone}: ${timezoneLabel(timezone)}` : undefined}
      actions={
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
            <Button
              type="button"
              size="sm"
              variant={customOpen ? "secondary" : "outline"}
              className="sm:hidden"
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((value) => !value)}
            >
              <CalendarDays className="mr-1.5 h-4 w-4" />
              {copy.reportsView.customRange}
            </Button>
          </div>
          <div className={cn("contents", !customOpen && "hidden sm:contents")}>
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
          </div>
        </form>
      }
    />
  );
}
