import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.mocked(getBusinessStory).mockReset();
  vi.mocked(getSalesByHour).mockResolvedValue([]);
  vi.mocked(getSalesSummary).mockResolvedValue(null as never);
});

describe("DashboardView period changes", () => {
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
