import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartCard } from "./ChartCard";

describe("ChartCard", () => {
  it("shows the empty label and hides children when empty", () => {
    render(
      <ChartCard title="Ventas" isEmpty emptyLabel="Sin datos">
        <div>chart-body</div>
      </ChartCard>,
    );
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
    expect(screen.queryByText("chart-body")).not.toBeInTheDocument();
  });

  it("renders the accessible summary and children when populated", () => {
    render(
      <ChartCard
        title="Ventas por día"
        subtitle="Cada barra es un día"
        srSummary="Mejor día: sábado con $4,210."
        isEmpty={false}
        emptyLabel="Sin datos"
      >
        <div>chart-body</div>
      </ChartCard>,
    );
    expect(screen.getByText("Ventas por día")).toBeInTheDocument();
    expect(screen.getByText("Mejor día: sábado con $4,210.")).toBeInTheDocument();
    expect(screen.getByText("chart-body")).toBeInTheDocument();
  });
});
