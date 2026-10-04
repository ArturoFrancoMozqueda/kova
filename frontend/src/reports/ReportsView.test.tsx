import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { copy } from "@/i18n/messages";
import { todayInTimezone } from "@/i18n/date";
import { makeStory } from "./__fixtures__/story";

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useTenantTimezone", () => ({
  useTenantTimezone: () => ({ timezone: "America/Mexico_City", isResolved: true }),
}));
vi.mock("@/auth/useFeature", () => ({ useFeature: vi.fn() }));
vi.mock("../auth/permissions", () => ({
  REPORTS_VIEW_ALL_PERMISSION: "reports.view.all",
  usePermission: () => true,
}));
vi.mock("./api", () => ({ getBusinessStory: vi.fn(), getSalesByHour: vi.fn() }));
vi.mock("../inventory/api", () => ({ listStock: vi.fn(), listVelocity: vi.fn() }));
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "authenticated", tenantId: "tenant-1" } }),
}));
const telemetry = vi.hoisted(() => ({
  trackAnalysisActionFeedback: vi.fn(),
  trackAnalysisActionState: vi.fn(),
  trackAnalysisViewed: vi.fn(),
}));
vi.mock("@/telemetry/funnel", () => telemetry);

import { getBusinessStory, getSalesByHour } from "./api";
import { listStock, listVelocity } from "../inventory/api";
import { useFeature } from "@/auth/useFeature";
import ReportsView from "./ReportsView";

const today = todayInTimezone("America/Mexico_City");

function renderView() {
  return render(
    <MemoryRouter>
      <ReportsView />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  (useFeature as Mock).mockReturnValue(false);
  (getSalesByHour as Mock).mockResolvedValue([]);
  (listStock as Mock).mockResolvedValue([]);
  (listVelocity as Mock).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReportsView", () => {
  it("associates unique Desde and Hasta labels with constrained date inputs", async () => {
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    renderView();
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.customRange }));

    const from = screen.getByLabelText(copy.reportsView.startDate);
    const to = screen.getByLabelText(copy.reportsView.endDate);
    expect(from).toHaveAttribute("id", "report-start-date");
    expect(to).toHaveAttribute("id", "report-end-date");
    expect(from).toHaveAttribute("max", today);
    expect(to).toHaveAttribute("min", today);
  });
  it("renders the summary once data loads", async () => {
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    renderView();
    expect(await screen.findByText(copy.reportsView.kpiNetSalesLabel)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.timingAnalysisTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.refundsSectionTitle)).toBeInTheDocument();
    // The priority action must be readable without any interaction.
    expect(screen.getByTestId("priority-recommendation")).toBeInTheDocument();
    expect(screen.queryByTestId("margin-analysis")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(telemetry.trackAnalysisViewed).toHaveBeenCalledWith(
        expect.objectContaining({
          range_days: 7,
          preset: "custom",
          recommendation_count: expect.any(Number),
        }),
      );
    });
  });

  it("tracks a completed recommendation and its usefulness feedback", async () => {
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    renderView();
    await screen.findByTestId("priority-recommendation");

    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.planMarkDone }));
    expect(telemetry.trackAnalysisActionState).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ surface: "prioridad" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: copy.reportsView.actionFeedbackHelpful }),
    );
    await waitFor(() => {
      expect(telemetry.trackAnalysisActionFeedback).toHaveBeenCalledWith(
        "helpful",
        expect.objectContaining({ surface: "prioridad" }),
      );
    });
  });

  it("shows exact margin only when the tenant flag is enabled", async () => {
    (useFeature as Mock).mockReturnValue(true);
    (getBusinessStory as Mock).mockResolvedValue(
      makeStory({
        margin: {
          summary: {
            net_sales: "10000.00",
            cogs: "4000.00",
            gross_profit: "6000.00",
            gross_margin_pct: "60.00",
            sold_products: 1,
            sold_products_without_cost: 0,
            complete: true,
          },
          by_day: [],
          by_product: [],
        },
        inventory_valuation: {
          value: "2500.00",
          known_value: "2500.00",
          tracked_products: 1,
          products_without_cost: 0,
          units_without_cost: 0,
          complete: true,
        },
        operating_expenses: {
          total: "1000.00",
          expense_count: 1,
          approximate_operating_profit: "5000.00",
          margin_complete: true,
          by_category: [
            { category: "renta", amount: "1000.00", expense_count: 1 },
          ],
        },
      }),
    );
    renderView();

    expect(await screen.findByTestId("margin-analysis")).toBeInTheDocument();
    expect(screen.getByText("$6,000.00")).toBeInTheDocument();
    expect(screen.getByText("60.00% de margen bruto")).toBeInTheDocument();
    expect(screen.getByTestId("operating-expense-analysis")).toBeInTheDocument();
  });

  it("shows the error state with a working retry", async () => {
    (getBusinessStory as Mock).mockRejectedValue(new Error("boom"));
    renderView();
    expect(await screen.findByText(copy.reportsView.loadError)).toBeInTheDocument();

    // Recover on retry.
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(copy.reportsView.retry, "i") }));
    expect(await screen.findByText(copy.reportsView.kpiNetSalesLabel)).toBeInTheDocument();
  });

  it("surfaces a notice when the previous-period fetch fails", async () => {
    (getBusinessStory as Mock).mockImplementation((start: string) =>
      start === today ? Promise.resolve(makeStory()) : Promise.reject(new Error("prev failed")),
    );
    renderView();
    expect(await screen.findByText(copy.reportsView.comparisonUnavailable)).toBeInTheDocument();
  });

  it("surfaces a notice when the hourly fetch fails", async () => {
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    (getSalesByHour as Mock).mockRejectedValue(new Error("hourly failed"));
    renderView();
    expect(await screen.findByText(copy.reportsView.hourlyUnavailable)).toBeInTheDocument();
  });

  it("keeps inventory failure distinct from untracked products and recovers on refresh", async () => {
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    (listStock as Mock).mockRejectedValue(new Error("stock unavailable"));
    renderView();
    expect(await screen.findByText(copy.reportsView.restockPlan.unavailable)).toBeInTheDocument();
    expect(screen.queryByText(/no tiene inventario vinculado/)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.reportsView.inventoryUnlinked)).not.toBeInTheDocument();
    (listStock as Mock).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.restockPlan.retry }));
    expect(await screen.findByText(copy.reportsView.restockPlan.noInventory)).toBeInTheDocument();
  });

  it("keeps current inventory planning available when the selected report has no sales", async () => {
    (getBusinessStory as Mock).mockResolvedValue(
      makeStory({ summary: { ...makeStory().summary, completed_orders: 0 } }),
    );
    (listStock as Mock).mockResolvedValue([{
      product_id: "p1", product_name: "Leche", sku: null, track_inventory: true,
      stock_on_hand: 10, reserved_quantity: 4, available_quantity: 6,
      low_stock_threshold: 3, is_low_stock: false,
    }]);
    (listVelocity as Mock).mockResolvedValue([{
      product_id: "p1", product_name: "Leche", stock_on_hand: 10,
      units_per_day_7d: "2.00", days_until_out: "5.0",
    }]);
    renderView();
    expect(await screen.findByText(copy.reportsView.restockPlan.suggested(8))).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.emptyStoryTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "14 días" }));
    expect(screen.getByText(copy.reportsView.restockPlan.suggested(22))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.reportsView.restockPlan.retry }));
    expect(await screen.findByText(copy.reportsView.restockPlan.suggested(22))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "14 días" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the empty business state when there are no completed orders", async () => {
    (getBusinessStory as Mock).mockResolvedValue(
      makeStory({ summary: { ...makeStory().summary, completed_orders: 0 } }),
    );
    renderView();
    expect(await screen.findByText(copy.reportsView.emptyStoryTitle)).toBeInTheDocument();
  });
});
