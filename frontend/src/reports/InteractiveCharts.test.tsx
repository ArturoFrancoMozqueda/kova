import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InteractiveBarChart, InteractiveRankChart, type ChartRow } from "./InteractiveCharts";

const rows: ChartRow[] = [
  {
    id: "13",
    label: "13:00-14:00",
    value: 90,
    valueLabel: "MX$90.00",
    meta: [{ label: "Ordenes", value: "2" }],
  },
  {
    id: "14",
    label: "14:00-15:00",
    value: 30,
    valueLabel: "MX$30.00",
    meta: [{ label: "Ordenes", value: "1" }],
  },
];

const commonProps = {
  detailPlaceholder: "Selecciona un punto para ver el detalle.",
  totalShareLabel: (pct: number) => `${pct}% del total`,
};

describe("InteractiveCharts", () => {
  it("renders empty state without fake bars", () => {
    render(
      <InteractiveBarChart
        title="Ventas por hora"
        rows={[]}
        emptyLabel="Sin ventas por hora"
        ariaLabel="Ventas por hora"
        {...commonProps}
      />,
    );

    expect(screen.getByText("Sin ventas por hora")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows amount, count, and percentage when a bar is selected and clears on second click", () => {
    render(
      <InteractiveBarChart
        title="Ventas por hora"
        rows={rows}
        emptyLabel="Sin ventas por hora"
        ariaLabel="Ventas por hora"
        {...commonProps}
      />,
    );

    const bar = screen.getByRole("button", { name: /13:00-14:00/i });
    fireEvent.click(bar);

    expect(screen.getByText("MX$90.00")).toBeInTheDocument();
    expect(screen.getByText("75% del total")).toBeInTheDocument();
    expect(screen.getByText("Ordenes: 2")).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(bar);

    expect(screen.getByText("Selecciona un punto para ver el detalle.")).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-pressed", "false");
  });

  it("uses the same accessible selection model for rank charts", () => {
    render(
      <InteractiveRankChart
        title="Productos top"
        rows={rows}
        emptyLabel="Sin productos"
        ariaLabel="Productos top"
        {...commonProps}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /14:00-15:00/i }));

    expect(screen.getAllByText("MX$30.00").length).toBeGreaterThan(0);
    expect(screen.getByText("25% del total")).toBeInTheDocument();
  });
});
