import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { formatDayWithWeekday } from "@/i18n/date";
import { makeStory } from "../__fixtures__/story";
import { AnalysisOverview } from "./AnalysisOverview";

describe("AnalysisOverview full-period chart", () => {
  it("includes all 45 days and the final day's sale instead of silently truncating at 31", () => {
    const story = makeStory({
      summary: { ...makeStory().summary, start_date: "2026-06-01", end_date: "2026-07-15", net_sales: "1250.00" },
      sales_by_day: [{ date: "2026-07-15", net_sales: "1250.00", order_count: 1, average_ticket: "1250.00", sales_share_pct: 100 }],
    });
    const { container } = render(<MemoryRouter><AnalysisOverview
      story={story} previousStory={null} previousFailed={false} trendStory={null}
      hourly={[]} hourlyFailed={false} priority={null} priorityDone={false}
      onTogglePriority={vi.fn()} onPriorityFeedback={vi.fn()}
    /></MemoryRouter>);
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(45);
    expect(screen.getByRole("button", { name: `${formatDayWithWeekday("2026-07-15")}: $1,250.00` })).toHaveAttribute("aria-pressed", "true");
  });

  it("explains gross payment amounts and shows the backend net when all sales are refunded", () => {
    const story = makeStory({
      summary: {
        ...makeStory().summary, gross_sales: "72.88", refund_total: "72.88", net_sales: "0.00",
        completed_orders: 7, refund_count: 7, average_ticket: "0.00",
      },
      payment_mix: [
        { method: "cash", amount: "40.88", refunded_amount: "40.88", net_amount: "0.00", payment_count: 5, sales_share_pct: 56 },
        { method: "bank_transfer", amount: "22.00", refunded_amount: "22.00", net_amount: "0.00", payment_count: 2, sales_share_pct: 30 },
        { method: "manual_card", amount: "10.00", refunded_amount: "10.00", net_amount: "0.00", payment_count: 1, sales_share_pct: 14 },
      ],
    });
    render(<MemoryRouter><AnalysisOverview
      story={story} previousStory={null} previousFailed={false} trendStory={null}
      hourly={[]} hourlyFailed={false} priority={null} priorityDone={false}
      onTogglePriority={vi.fn()} onPriorityFeedback={vi.fn()}
    /></MemoryRouter>);
    expect(screen.getByText(/los pagos muestran el bruto cobrado/)).toBeVisible();
    expect(screen.getByText("Ventas brutas: $72.88 · Devoluciones: $72.88 · Ventas netas: $0.00.")).toBeVisible();
    expect(screen.getByText("$40.88")).toBeVisible();
    expect(screen.getByText("56%")).toBeVisible();
  });
});
