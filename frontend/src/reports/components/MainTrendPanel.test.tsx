import { cloneElement, isValidElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Same jsdom shim as charts/render.test.tsx: give Recharts a real size so the
// SVG actually draws.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as React.ReactElement, { width: 800, height: 300 })
        : children,
  };
});

import { makeStory } from "../__fixtures__/story";
import { MainTrendPanel } from "./MainTrendPanel";

function makePreviousStory() {
  return makeStory({
    summary: {
      ...makeStory().summary,
      start_date: "2026-06-24",
      end_date: "2026-06-30",
      net_sales: "8000",
      completed_orders: 80,
    },
    sales_by_day: [
      { date: "2026-06-24", net_sales: "900", order_count: 9, average_ticket: "100", sales_share_pct: 11 },
      { date: "2026-06-28", net_sales: "3100", order_count: 30, average_ticket: "103", sales_share_pct: 39 },
    ],
  });
}

describe("MainTrendPanel", () => {
  it("overlays the previous comparable period aligned by day index", () => {
    const { container } = render(
      <MainTrendPanel story={makeStory()} previousStory={makePreviousStory()} />,
    );
    // Legend announces the comparison.
    expect(screen.getByText("Este periodo")).toBeInTheDocument();
    expect(screen.getByText("Periodo anterior")).toBeInTheDocument();
    // The dashed overlay draws as a Recharts line.
    expect(container.querySelector(".recharts-line")).toBeInTheDocument();
    // Best day (5 jul, index 4) is pre-selected; the previous period's day at
    // the same index (28 jun) had $3,100 — exact figure, no ambiguity.
    expect(screen.getByRole("status")).toHaveTextContent(
      "mismo día del periodo anterior: $3,100.00",
    );
    // The sr summary carries the previous period total.
    expect(
      screen.getByText(/El periodo anterior comparable sumó \$8,000\.00/),
    ).toBeInTheDocument();
  });

  it("hides the overlay when the previous period had no sales", () => {
    const empty = makeStory({
      summary: { ...makeStory().summary, completed_orders: 0, net_sales: "0" },
      sales_by_day: [],
    });
    const { container } = render(<MainTrendPanel story={makeStory()} previousStory={empty} />);
    expect(screen.queryByText("Periodo anterior")).not.toBeInTheDocument();
    expect(container.querySelector(".recharts-line")).not.toBeInTheDocument();
  });

  it("uses the trailing-7-days story without overlay on single-day ranges", () => {
    const today = makeStory({
      summary: { ...makeStory().summary, start_date: "2026-07-07", end_date: "2026-07-07" },
    });
    const { container } = render(
      <MainTrendPanel story={today} previousStory={makePreviousStory()} trendStory={makeStory()} />,
    );
    // Chart renders from the 7-day context…
    expect(container.querySelector("svg")).toBeInTheDocument();
    // …but never claims a comparison it cannot align.
    expect(screen.queryByText("Periodo anterior")).not.toBeInTheDocument();
  });
});
