import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { copy } from "@/i18n/messages";
import { makeStory } from "../__fixtures__/story";
import { TimingAnalysis } from "./TimingAnalysis";

const todayOnly = makeStory({
  summary: { ...makeStory().summary, start_date: "2026-07-07", end_date: "2026-07-07" },
});

describe("TimingAnalysis (single-day range)", () => {
  it("keeps the daily chart on 'Hoy' using the trailing-7-days context", () => {
    const trendStory = makeStory(); // 2026-07-01 → 2026-07-07
    render(
      <TimingAnalysis
        story={todayOnly}
        hourly={[]}
        hourlyFailed={false}
        previousStory={null}
        trendStory={trendStory}
      />,
    );
    expect(screen.getByText(copy.reportsView.salesTrendChartTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.salesTrendContextSubtitle)).toBeInTheDocument();
  });

  it("omits the daily chart when the context fetch failed", () => {
    render(
      <TimingAnalysis
        story={todayOnly}
        hourly={[]}
        hourlyFailed={false}
        previousStory={null}
        trendStory={null}
      />,
    );
    expect(screen.queryByText(copy.reportsView.salesTrendChartTitle)).not.toBeInTheDocument();
  });
});
