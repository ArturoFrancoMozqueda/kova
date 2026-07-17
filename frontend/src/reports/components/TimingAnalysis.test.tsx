import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { copy } from "@/i18n/messages";
import { makeStory } from "../__fixtures__/story";
import { DaypartsPanel, TopHoursPanel } from "./TimingAnalysis";

describe("DaypartsPanel", () => {
  it("answers the strongest block with exact money and share", () => {
    render(<DaypartsPanel story={makeStory()} previousStory={null} />);
    // Fixture: tarde = $5,000 (50%).
    expect(screen.getByText("Tarde concentra $5,000.00 (50% de la venta)")).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.daypartGridTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.reportsView.daypartStrongest)).toBeInTheDocument();
    // Every block keeps its meter with the exact share.
    expect(screen.getAllByRole("meter").length).toBe(3);
  });
});

describe("TopHoursPanel", () => {
  it("degrades visibly when the hourly dataset failed", () => {
    render(<TopHoursPanel hourly={[]} hourlyFailed rangeDays={7} />);
    expect(screen.getByText(copy.reportsView.hourlyUnavailable)).toBeInTheDocument();
  });

  it("answers the best hour with its exact sales", () => {
    const hourly = [
      { hour: 13, net_sales: "2500", order_count: 25 },
      { hour: 9, net_sales: "1200", order_count: 10 },
      { hour: 18, net_sales: "800", order_count: 8 },
    ];
    render(<TopHoursPanel hourly={hourly} hourlyFailed={false} rangeDays={7} />);
    expect(screen.getByText("Tu mejor hora: 13:00–14:00 · $2,500.00")).toBeInTheDocument();
  });
});
