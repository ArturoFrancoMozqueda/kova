import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { copy } from "@/i18n/messages";
import { makeStory } from "../__fixtures__/story";
import { DaypartsPanel, TopHoursPanel } from "./TimingAnalysis";

describe("DaypartsPanel", () => {
  it.each([[1, "1 orden"], [2, "2 órdenes"]] as const)(
    "uses the correct order count for a block with %i orders",
    (count, expected) => {
      const row = makeStory().sales_by_daypart[1]!;
      render(<DaypartsPanel story={makeStory({
        sales_by_daypart: [{ ...row, order_count: count, net_sales: "128", sales_share_pct: 100 }],
      })} previousStory={null} />);
      expect(screen.getByText(`100% del total · ${expected} · $100.00`)).toBeInTheDocument();
    },
  );

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

it("shows five zero-net tickets alongside the other two completed tickets", () => {
  const base = makeStory();
  render(<DaypartsPanel story={makeStory({
    summary: { ...base.summary, gross_sales: "238.88", refund_total: "72.88", net_sales: "166.00",
      completed_orders: 7, average_ticket: "23.71" },
    sales_by_daypart: [
      { ...base.sales_by_daypart[0], net_sales: "0.00", order_count: 5, average_ticket: "0.00", sales_share_pct: 0 },
      { ...base.sales_by_daypart[1], net_sales: "128.00", order_count: 1, average_ticket: "128.00", sales_share_pct: 77 },
      { ...base.sales_by_daypart[2], net_sales: "38.00", order_count: 1, average_ticket: "38.00", sales_share_pct: 23 },
    ],
  })} previousStory={null} />);
  expect(screen.getByText("$0.00 netos")).toBeVisible();
  expect(screen.getByText("5 órdenes · Ticket promedio neto $0.00")).toBeVisible();
  expect(screen.getByText("77% del total · 1 orden · $128.00")).toBeVisible();
  expect(screen.getByText("23% del total · 1 orden · $38.00")).toBeVisible();
  expect(screen.queryByText("Sin operaciones")).not.toBeInTheDocument();
  expect(screen.getAllByRole("meter")).toHaveLength(2);
});

it("preserves negative net amounts and counts without an invalid percentage meter", () => {
  const row = makeStory().sales_by_daypart[0];
  render(<DaypartsPanel story={makeStory({ sales_by_daypart: [{ ...row,
    net_sales: "-10.00", order_count: 2, average_ticket: "-5.00", sales_share_pct: -10,
  }] })} previousStory={null} />);
  expect(screen.getByText("-$10.00 netos")).toBeVisible();
  expect(screen.getByText("2 órdenes · Ticket promedio neto -$5.00")).toBeVisible();
  expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  expect(screen.queryByText("Sin operaciones")).not.toBeInTheDocument();
});

it("distinguishes an empty block from completed tickets with zero net sales", () => {
  const row = makeStory().sales_by_daypart[0];
  render(<DaypartsPanel story={makeStory({ sales_by_daypart: [{ ...row,
    net_sales: "0.00", order_count: 0, average_ticket: "0.00", sales_share_pct: 0,
  }] })} previousStory={null} />);
  expect(screen.getByText("Sin operaciones")).toBeVisible();
  expect(screen.queryByText(/órdenes/)).not.toBeInTheDocument();
});
