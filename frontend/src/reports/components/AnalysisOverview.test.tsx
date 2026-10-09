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
});
