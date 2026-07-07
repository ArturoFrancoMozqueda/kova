import { cloneElement, isValidElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom has no layout, so Recharts' ResponsiveContainer measures 0x0 and draws
// nothing. Replace it with a fixed-size passthrough that injects width/height
// into the chart child (what the real container does) so we can assert the SVG
// actually renders with data.
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

import { DistributionBar, type DistributionSegment } from "./DistributionBar";
import { RankBarChart } from "./RankBarChart";
import { SalesTrendChart, type SalesDayPoint } from "./SalesTrendChart";
import type { ChartRow } from "./types";

const rankRows: ChartRow[] = [
  { id: "cash", label: "Efectivo", value: 6700, valueLabel: "MX$6,700", meta: [{ label: "Pagos", value: "67" }] },
  { id: "card", label: "Tarjeta", value: 3300, valueLabel: "MX$3,300", meta: [{ label: "Pagos", value: "33" }] },
];

const dayPoints: SalesDayPoint[] = [
  { id: "2026-07-01", axisLabel: "1 jul", fullLabel: "1 de julio", value: 1200, valueLabel: "MX$1,200", orderCount: 12, avgTicketLabel: "MX$100", vsPrevLabel: null, sharePct: 22, isZero: false },
  { id: "2026-07-02", axisLabel: "2 jul", fullLabel: "2 de julio", value: 4210, valueLabel: "MX$4,210", orderCount: 40, avgTicketLabel: "MX$105", vsPrevLabel: "+251%", sharePct: 78, isZero: false },
];

describe("chart rendering (with a real size)", () => {
  it("draws bars for a rank chart and exposes an accessible summary", () => {
    const { container } = render(
      <RankBarChart title="Pagos" rows={rankRows} emptyLabel="Sin pagos" srSummary="Resumen de pagos." />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
    expect(screen.getByText("Resumen de pagos.")).toBeInTheDocument();
  });

  it("draws the sales trend and pre-populates the detail card with the best day", () => {
    const { container } = render(
      <SalesTrendChart points={dayPoints} average={2705} bestDayId="2026-07-02" rangeDays={2} srSummary="Ventas por día." />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
    // Best day is pre-selected → detail card is populated without interaction.
    expect(screen.getByText("Mejor día del periodo")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("MX$4,210");
  });

  it("draws the payment mix as one stacked 100% bar with a single-source legend", () => {
    const segments: DistributionSegment[] = [
      { id: "cash", label: "Efectivo", value: 6700, valueLabel: "MX$6,700", sharePct: 67, meta: "6 transacciones" },
      { id: "card", label: "Tarjeta", value: 3300, valueLabel: "MX$3,300", sharePct: 33, meta: "3 transacciones" },
    ];
    const { container } = render(
      <DistributionBar segments={segments} emptyLabel="Sin pagos" srSummary="Efectivo: 67%, Tarjeta: 33%." />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    // One stacked rectangle per method.
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(2);
    // Legend carries label, share and amount exactly once each.
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getAllByText("MX$6,700")).toHaveLength(1);
  });

  it("keeps the reference-line and best-day labels legible", () => {
    render(
      <SalesTrendChart points={dayPoints} average={2705} bestDayId="2026-07-02" rangeDays={2} />,
    );
    // Average reference label uses the "Prom." prefix.
    expect(screen.getByText(/Prom\./)).toBeInTheDocument();
  });
});

describe("chart empty states", () => {
  it("renders the empty label instead of an axis when there is no data", () => {
    const { container } = render(
      <RankBarChart title="Pagos" rows={[]} emptyLabel="Sin pagos en este rango" />,
    );
    expect(screen.getByText("Sin pagos en este rango")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
