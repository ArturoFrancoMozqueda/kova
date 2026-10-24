import { formatDayWithWeekday } from "@/i18n/date";
import { addDays, daysBetweenInclusive } from "@/reports/utils/dateRange";
import type { BusinessStoryReport, SalesByHourRow } from "@/reports/types";

export type SalesTrendPoint = { id: string; label: string; value: number };
export function salesTrendPoints(story: BusinessStoryReport, hourly: SalesByHourRow[], byHour: boolean): SalesTrendPoint[] {
  if (byHour) {
    if (!hourly.length) return [];
    const values = new Map(hourly.map(row => [row.hour, Number(row.net_sales)]));
    return Array.from({ length: 24 }, (_, hour) => ({ id: String(hour), label: `${String(hour).padStart(2, "0")}:00`, value: values.get(hour) ?? 0 }));
  }
  const values = new Map(story.sales_by_day.map(row => [row.date, Number(row.net_sales)]));
  return Array.from({ length: daysBetweenInclusive(story.summary.start_date, story.summary.end_date) }, (_, index) => {
    const date = addDays(story.summary.start_date, index);
    return { id: date, label: formatDayWithWeekday(date), value: values.get(date) ?? 0 };
  });
}
