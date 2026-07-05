import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { copy } from "@/i18n/messages";
import { todayInTimezone } from "@/i18n/date";
import { makeStory } from "./__fixtures__/story";

vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useTenantTimezone", () => ({
  useTenantTimezone: () => ({ timezone: "America/Mexico_City", isResolved: true }),
}));
vi.mock("../auth/permissions", () => ({
  REPORTS_VIEW_ALL_PERMISSION: "reports.view.all",
  usePermission: () => true,
}));
vi.mock("./api", () => ({ getBusinessStory: vi.fn(), getSalesByHour: vi.fn() }));
vi.mock("../inventory/api", () => ({ listStock: vi.fn(), listVelocity: vi.fn() }));

import { getBusinessStory, getSalesByHour } from "./api";
import { listStock, listVelocity } from "../inventory/api";
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
  (getSalesByHour as Mock).mockResolvedValue([]);
  (listStock as Mock).mockResolvedValue([]);
  (listVelocity as Mock).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReportsView", () => {
  it("renders the summary once data loads", async () => {
    (getBusinessStory as Mock).mockResolvedValue(makeStory());
    renderView();
    expect(await screen.findByText(copy.reportsView.kpiNetSalesLabel)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.timingAnalysisTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.refundsSectionTitle)).toBeInTheDocument();
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

  it("shows the empty business state when there are no completed orders", async () => {
    (getBusinessStory as Mock).mockResolvedValue(
      makeStory({ summary: { ...makeStory().summary, completed_orders: 0 } }),
    );
    renderView();
    expect(await screen.findByText(copy.reportsView.emptyStoryTitle)).toBeInTheDocument();
  });
});
