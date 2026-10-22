import type { BillingSubscription } from "@/billing/types";
import type { StockItem } from "@/inventory/types";
import type { OnboardingState } from "@/onboarding/api";
import type { BusinessStoryReport, SalesByHourRow, SalesSummary } from "@/reports/types";

export type DashboardPeriod = "day" | "week" | "month";
export type DashboardOverview = {
  story: BusinessStoryReport;
  hourly: SalesByHourRow[];
  previous_summary: SalesSummary;
  timezone: string;
  active_catalog_count: number;
  tracked_inventory_count: number;
  low_stock_items: StockItem[];
  active_employee_count: number | null;
  closed_shift_count: number;
  billing: BillingSubscription | null;
  onboarding: OnboardingState;
};

export async function getDashboardOverview(period: DashboardPeriod): Promise<DashboardOverview | null> {
  const response = await fetch(`/api/v1/reports/dashboard?${new URLSearchParams({ period })}`, {
    cache: "no-store",
  });
  // An older backend may briefly serve an installed PWA during recovery. Only
  // an absent endpoint enables the existing read path; auth/server errors stop.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`No se pudo cargar el panel (${response.status}).`);
  return response.json() as Promise<DashboardOverview>;
}
