import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { copy } from "@/i18n/messages";
import { makeStory } from "@/reports/__fixtures__/story";
import type { BusinessStoryReport } from "@/reports/types";

vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({ state: {
  status: "authenticated", tenantId: "tenant-1", tenantName: "Mi negocio", user: { id: "user-1" },
} }) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("./api", () => ({ getDashboardOverview: vi.fn().mockResolvedValue(null) }));
vi.mock("@/reports/api", () => ({ getBusinessStory: vi.fn(), getSalesByHour: vi.fn(), getSalesSummary: vi.fn() }));
vi.mock("@/catalog/api", () => ({ listProducts: vi.fn().mockResolvedValue([]) }));
vi.mock("@/inventory/api", () => ({ listStock: vi.fn().mockResolvedValue([]), listLowStock: vi.fn().mockResolvedValue([]) }));
vi.mock("@/billing/api", () => ({ getBillingSubscription: vi.fn().mockResolvedValue(null) }));
vi.mock("@/onboarding/api", () => ({ getOnboardingState: vi.fn().mockResolvedValue(null) }));
vi.mock("@/settings/api", () => ({
  getBusinessProfile: vi.fn().mockResolvedValue({ timezone: "America/Mexico_City" }),
  listEmployees: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/shifts/api", () => ({ listClosedShifts: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/brand/RealTime", () => ({ CountUp: ({ value }: { value: number }) => <span data-testid="net-sales">{value}</span> }));
vi.mock("./BusinessHealthCard", () => ({ BusinessHealthCard: () => null }));
vi.mock("./InsightStrip", () => ({ InsightStrip: () => null }));

import { getBusinessStory, getSalesByHour, getSalesSummary } from "@/reports/api";
import { listProducts } from "@/catalog/api";
import { listLowStock, listStock } from "@/inventory/api";
import { getBillingSubscription } from "@/billing/api";
import { getOnboardingState } from "@/onboarding/api";
import { getBusinessProfile, listEmployees, type BusinessProfile } from "@/settings/api";
import { listClosedShifts } from "@/shifts/api";
import DashboardView from "./DashboardView";
import { summaryFromStory } from "./storyAdapters";
import { getDashboardOverview, type DashboardOverview } from "./api";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboardOverview).mockResolvedValue(null);
  vi.mocked(getBusinessProfile).mockResolvedValue({ timezone: "America/Mexico_City" } as BusinessProfile);
  vi.mocked(getBusinessStory).mockReset();
  vi.mocked(getSalesByHour).mockResolvedValue([]);
  vi.mocked(getSalesSummary).mockResolvedValue(null as never);
});
afterEach(() => vi.useRealTimers());

describe("DashboardView period changes", () => {
  it("loads the complete panel from one overview without repeating the legacy reads", async () => {
    const story = makeStory();
    vi.mocked(getDashboardOverview).mockResolvedValue({
      story, hourly: [], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
      active_catalog_count: 4, tracked_inventory_count: 2, low_stock_items: [],
      active_employee_count: 1, closed_shift_count: 3, billing: null,
      onboarding: { tenant_id: "tenant-1", completed_count: 0, total_count: 0, steps: [] },
    });
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await screen.findByTestId("net-sales");
    expect(getDashboardOverview).toHaveBeenCalledExactlyOnceWith("day");
    for (const legacy of [getBusinessStory, getSalesByHour, getSalesSummary, getBusinessProfile,
      listProducts, listStock, listLowStock, listEmployees, listClosedShifts, getOnboardingState]) {
      expect(legacy).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole("radio", { name: "30 días" }));
    await waitFor(() => expect(getDashboardOverview).toHaveBeenLastCalledWith("month"));
  });

  it("does not retry rejected overview requests through the legacy report endpoints", async () => {
    vi.mocked(getDashboardOverview).mockRejectedValue(new Error("report access denied"));
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await screen.findByText(copy.dashboard.loadError);
    expect(getBusinessStory).not.toHaveBeenCalled();
    expect(getBusinessProfile).not.toHaveBeenCalled();
  });

  it("ignores an overview that finishes after a newer period", async () => {
    let resolveOld!: (value: DashboardOverview) => void;
    const story = makeStory();
    const overview: DashboardOverview = {
      story, hourly: [], previous_summary: summaryFromStory(story), timezone: "America/Mexico_City",
      active_catalog_count: 4, tracked_inventory_count: 2, low_stock_items: [],
      active_employee_count: null, closed_shift_count: 0, billing: null,
      onboarding: { tenant_id: "tenant-1", completed_count: 0, total_count: 0, steps: [] },
    };
    vi.mocked(getDashboardOverview)
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ...overview,
        story: makeStory({ summary: { ...story.summary, net_sales: "222.00" } }) });
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    fireEvent.click(screen.getByRole("radio", { name: "7 días" }));
    expect(await screen.findByTestId("net-sales")).toHaveTextContent("222");
    await act(async () => resolveOld(overview));
    expect(screen.getByTestId("net-sales")).toHaveTextContent("222");
  });

  it("starts independent reads before the timezone resolves, while reports use the tenant's day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T06:30:00Z"));
    let resolveProfile!: (profile: BusinessProfile) => void;
    vi.mocked(getBusinessProfile).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProfile = resolve;
    }));
    vi.mocked(getBusinessStory).mockResolvedValue(makeStory());
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    // The older-backend path starts after the overview's explicit 404 result.
    await waitFor(() => expect(listProducts).toHaveBeenCalledOnce());
    for (const read of [listProducts, listStock, listLowStock, getBillingSubscription,
      getOnboardingState, listEmployees, listClosedShifts]) {
      expect(read).toHaveBeenCalledOnce();
    }
    expect(getBusinessStory).not.toHaveBeenCalled();
    expect(getSalesByHour).not.toHaveBeenCalled();
    expect(getSalesSummary).not.toHaveBeenCalled();
    await act(async () => resolveProfile({ timezone: "America/Tijuana" } as BusinessProfile));
    await screen.findByTestId("net-sales");
    expect(getBusinessStory).toHaveBeenCalledWith("2026-10-07", "2026-10-07");
    expect(getSalesByHour).toHaveBeenCalledWith("2026-10-07", "2026-10-07");
    expect(getSalesSummary).toHaveBeenCalledWith("2026-10-06", "2026-10-06");
  });

  it("retains the default timezone if the profile is unavailable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T06:30:00Z"));
    vi.mocked(getBusinessProfile).mockRejectedValueOnce(new Error("unavailable"));
    vi.mocked(getBusinessStory).mockResolvedValue(makeStory());
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await screen.findByTestId("net-sales");
    expect(getBusinessStory).toHaveBeenCalledWith("2026-10-08", "2026-10-08");
  });

  it("labels every supported payment method in Spanish in the dashboard legend", async () => {
    vi.mocked(getBusinessStory).mockResolvedValue(makeStory({ payment_mix: [
      { method: "cash", amount: "10.00", refunded_amount: "0.00", net_amount: "10.00", payment_count: 1, sales_share_pct: 33 },
      { method: "bank_transfer", amount: "10.00", refunded_amount: "0.00", net_amount: "10.00", payment_count: 1, sales_share_pct: 33 },
      { method: "manual_card", amount: "10.00", refunded_amount: "0.00", net_amount: "10.00", payment_count: 1, sales_share_pct: 33 },
    ] }));
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await screen.findByTestId("net-sales");
    for (const method of ["Efectivo", "Transferencia", "Tarjeta manual"]) {
      expect(screen.getByText(method, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByText("Cobros antes de devoluciones")).toBeInTheDocument();
    for (const raw of ["cash", "bank transfer", "manual card"]) {
      expect(screen.queryByText(raw, { exact: true })).not.toBeInTheDocument();
    }
  });

  it("describes and compares trailing 30-day ranges with their real dates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T18:00:00Z"));
    vi.mocked(getBusinessStory).mockResolvedValue(makeStory());
    vi.mocked(getSalesSummary).mockResolvedValue(summaryFromStory(makeStory({
      summary: { ...makeStory().summary, net_sales: "5000.00" },
    })));
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await screen.findByTestId("net-sales");
    fireEvent.click(screen.getByRole("radio", { name: "30 días" }));
    await waitFor(() => expect(getBusinessStory).toHaveBeenCalledWith("2026-09-09", "2026-10-08"));
    expect(getSalesSummary).toHaveBeenCalledWith("2026-08-10", "2026-09-08");
    expect(screen.getByText("Esto es lo que pasó en los últimos 30 días.")).toBeInTheDocument();
    expect(await screen.findByText(/vs 30 días anteriores/)).toBeInTheDocument();
  });
  it("groups metric terms and descriptions with valid definition-list semantics", async () => {
    vi.mocked(getBusinessStory).mockResolvedValue(makeStory());
    const { container } = render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await screen.findByTestId("net-sales");
    const result = await axe(container, { runOnly: { type: "rule", values: ["definition-list", "dlitem"] } });
    expect(result.violations).toEqual([]);
  });
  it.each(["success", "failure"])("keeps the latest period when the previous request finishes with %s", async (outcome) => {
    let resolveOld!: (story: BusinessStoryReport) => void;
    let rejectOld!: (error: Error) => void;
    vi.mocked(getBusinessStory)
      .mockImplementationOnce(() => new Promise((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      }))
      .mockResolvedValueOnce(makeStory({ summary: { ...makeStory().summary, net_sales: "222.00" } }));
    render(<MemoryRouter><DashboardView /></MemoryRouter>);
    await waitFor(() => expect(getBusinessStory).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("radio", { name: copy.dashboard.periodWeek }));
    expect(await screen.findByTestId("net-sales")).toHaveTextContent("222");
    await act(async () => {
      if (outcome === "success") resolveOld(makeStory({ summary: { ...makeStory().summary, net_sales: "111.00" } }));
      else rejectOld(new Error("slow failed request"));
    });
    expect(screen.getByTestId("net-sales")).toHaveTextContent("222");
    expect(screen.queryByText(copy.dashboard.loadError)).not.toBeInTheDocument();
  });
});
