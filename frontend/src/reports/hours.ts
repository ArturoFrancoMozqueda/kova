import type { SalesByHourRow } from "./types";

/**
 * Canonical hour-of-day range label. Single source of truth for how an hour
 * bucket is shown across Panel and Reportes so the two screens never disagree.
 *
 * formatHourRange(9)  => "09:00–10:00"
 * formatHourRange(23) => "23:00–00:00"  (wraps past midnight)
 */
export function formatHourRange(hour: number): string {
  const pad = (h: number) => String(h).padStart(2, "0");
  return `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`;
}

/**
 * Hours that had sales, ranked by net sales descending, capped at `n`.
 * Mirrors the ranking Reportes already used so the Panel "Tus mejores horas"
 * summary and the Reportes "Tus 3 mejores horas" chart reconcile by construction.
 */
export function topHoursByNetSales(rows: SalesByHourRow[], n: number): SalesByHourRow[] {
  return rows
    .filter((row) => Number(row.net_sales) > 0)
    .sort((a, b) => Number(b.net_sales) - Number(a.net_sales))
    .slice(0, n);
}

/**
 * Total net sales across every hour bucket. Used to express a single hour's
 * "% del día" — its share of the whole day — independent of the top-N ranking.
 */
export function totalNetSales(rows: SalesByHourRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.net_sales), 0);
}
