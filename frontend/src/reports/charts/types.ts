export type ChartMetaLine = {
  label: string;
  value: string;
};

/** A single datum shared by the report charts and their detail panel. */
export type ChartRow = {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  meta?: ChartMetaLine[];
  /** Highlight this row (e.g. the best day) with the solid accent fill. */
  emphasized?: boolean;
};

export function percentOfTotal(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
