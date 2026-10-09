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
import DashboardView from "./DashboardView";
import { summaryFromStory } from "./storyAdapters";

beforeEach(() => {
  vi.mocked(getBusinessStory).mockReset();
  vi.mocked(getSalesByHour).mockResolvedValue([]);
  vi.mocked(getSalesSummary).mockResolvedValue(null as never);
});
afterEach(() => vi.useRealTimers());

describe("DashboardView period changes", () => {
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
