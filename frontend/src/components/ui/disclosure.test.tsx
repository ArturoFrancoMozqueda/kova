import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MOTION_MS } from "@/lib/motion";
import { Disclosure } from "./disclosure";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure open={open} onOpenChange={setOpen} trigger={open ? "Ocultar detalle" : "Ver detalle"}>
      <button type="button">Acción interna</button>
    </Disclosure>
  );
}

describe("Disclosure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("links its trigger and region, then makes the exiting panel inert", () => {
    vi.useFakeTimers();
    render(<Example />);

    const closedTrigger = screen.getByRole("button", { name: "Ver detalle" });
    expect(closedTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    fireEvent.click(closedTrigger);
    const openTrigger = screen.getByRole("button", { name: "Ocultar detalle" });
    const panel = screen.getByRole("region");
    expect(openTrigger).toHaveAttribute("aria-expanded", "true");
    expect(openTrigger).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", openTrigger.id);

    fireEvent.click(openTrigger);
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");

    act(() => vi.advanceTimersByTime(MOTION_MS.panelExit));
    expect(screen.queryByRole("region", { hidden: true })).not.toBeInTheDocument();
  });
});
