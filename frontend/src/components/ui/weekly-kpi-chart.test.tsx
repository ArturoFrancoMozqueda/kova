import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WeeklyKpiChart } from "./weekly-kpi-chart";

const points = [
  { id: "monday", label: "Lu", fullLabel: "Lunes", value: 100, valueLabel: "$100.00" },
  { id: "tuesday", label: "Ma", fullLabel: "Martes", value: 250, valueLabel: "$250.00" },
];

describe("WeeklyKpiChart", () => {
  it("selects the strongest point by default and supports choosing another day", () => {
    render(
      <WeeklyKpiChart
        data={points}
        referenceValue={150}
        referenceLabel="Promedio anterior: $150.00"
      />,
    );

    const monday = screen.getByRole("button", { name: "Lunes: $100.00" });
    const tuesday = screen.getByRole("button", { name: "Martes: $250.00" });
    expect(tuesday).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Promedio anterior: $150.00")).toBeInTheDocument();

    fireEvent.click(monday);
    expect(monday).toHaveAttribute("aria-pressed", "true");
    expect(tuesday).toHaveAttribute("aria-pressed", "false");
  });
});
