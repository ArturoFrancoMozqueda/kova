import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import { MOTION_MS } from "@/lib/motion";
import PWAUpdatePrompt from "./PWAUpdatePrompt";

describe("PWAUpdatePrompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces an update and leaves without a focusable ghost", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <PWAUpdatePrompt />
      </MemoryRouter>,
    );

    act(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    const prompt = screen.getByRole("status");
    expect(prompt).toHaveTextContent(copy.pwaUpdate.title);

    fireEvent.click(screen.getByRole("button", { name: copy.pwaUpdate.later }));
    expect(prompt).toHaveAttribute("aria-hidden", "true");
    expect(prompt).toHaveAttribute("inert");

    act(() => vi.advanceTimersByTime(MOTION_MS.panelExit));
    expect(screen.queryByRole("status", { hidden: true })).not.toBeInTheDocument();
  });
});
