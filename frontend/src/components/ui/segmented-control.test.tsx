import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
] as const;

function StatefulControl({ initialValue = "today" }: { initialValue?: string | null }) {
  const [value, setValue] = useState<string | null>(initialValue);
  return (
    <SegmentedControl
      ariaLabel="Periodo"
      options={OPTIONS}
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("SegmentedControl", () => {
  it("selects an option and exposes the active value as a radio", () => {
    render(<StatefulControl />);

    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));

    expect(screen.getByRole("radio", { name: "Semana" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Hoy" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves selection and focus with radio-group keyboard navigation", () => {
    render(<StatefulControl />);
    const group = screen.getByRole("radiogroup", { name: "Periodo" });
    screen.getByRole("radio", { name: "Hoy" }).focus();

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Semana" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Semana" })).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(group, { key: "End" });
    expect(screen.getByRole("radio", { name: "Mes" })).toHaveFocus();
  });

  it("keeps the first option tabbable when an external custom range is active", () => {
    render(<StatefulControl initialValue={null} />);

    expect(screen.getByRole("radio", { name: "Hoy" })).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("renders a trailing action outside the radio group", () => {
    const onCustom = vi.fn();
    render(
      <SegmentedControl ariaLabel="Periodo" options={OPTIONS} value="today" onValueChange={() => {}}>
        <button type="button" onClick={onCustom}>Personalizar</button>
      </SegmentedControl>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Personalizar" }));
    expect(onCustom).toHaveBeenCalledOnce();
    expect(screen.getByRole("radiogroup")).not.toContainElement(
      screen.getByRole("button", { name: "Personalizar" }),
    );
  });

  it("preserves button semantics when requested", () => {
    render(
      <SegmentedControl
        ariaLabel="Periodo"
        options={OPTIONS}
        value="today"
        onValueChange={() => {}}
        selectionMode="button"
      />,
    );

    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});
