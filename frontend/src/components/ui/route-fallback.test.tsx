import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShellRouteFallback } from "./route-fallback";

describe("ShellRouteFallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not flash for routes that resolve inside the reveal delay", () => {
    vi.useFakeTimers();
    render(<ShellRouteFallback delayMs={140} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(139));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status", { name: "Cargando vista" })).toBeVisible();
  });

  it("can render immediately when the caller needs an eager status", () => {
    render(<ShellRouteFallback delayMs={0} label="Preparando caja" />);
    expect(screen.getByRole("status", { name: "Preparando caja" })).toBeVisible();
  });
});
