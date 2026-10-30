import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RouteFallback, ShellRouteFallback } from "./route-fallback";

describe("ShellRouteFallback", () => {
  it("reserves the initial layout without a spinner or pre-session controls", () => {
    const { container } = render(<RouteFallback />);
    expect(screen.getByRole("status", { name: "Cargando" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
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
    render(<ShellRouteFallback delayMs={0} label="Preparando caja" viewName="Caja" />);
    expect(screen.getByRole("status", { name: "Preparando caja" })).toBeVisible();
    expect(screen.getByText("Caja")).toBeVisible();
  });
});
