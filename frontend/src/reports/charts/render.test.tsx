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

import { RankBarChart } from "./RankBarChart";
import type { ChartRow } from "./types";

const rankRows: ChartRow[] = [
  { id: "cash", label: "Efectivo", value: 6700, valueLabel: "MX$6,700", meta: [{ label: "Pagos", value: "67" }] },
  { id: "card", label: "Tarjeta", value: 3300, valueLabel: "MX$3,300", meta: [{ label: "Pagos", value: "33" }] },
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
