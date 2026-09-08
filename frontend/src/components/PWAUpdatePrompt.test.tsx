import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";
import { MOTION_MS } from "@/lib/motion";
import PWAUpdatePrompt from "./PWAUpdatePrompt";

function GoToDashboard() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/dashboard")}>Ir al panel</button>;
}

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

  it("explains that an update is deferred while the current operation is unsafe to reload", () => {
    const applyUpdate = vi.fn();
    window.addEventListener("pos:pwa-apply-update", applyUpdate);
    render(
      <MemoryRouter initialEntries={["/pedidos"]}>
        <PWAUpdatePrompt />
        <GoToDashboard />
      </MemoryRouter>,
    );

    act(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    fireEvent.click(screen.getByRole("button", { name: copy.pwaUpdate.update }));

    expect(applyUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(copy.pwaUpdate.deferredDescription)).toBeVisible();
    expect(screen.getByRole("button", { name: copy.pwaUpdate.waiting })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Ir al panel" }));
    expect(applyUpdate).toHaveBeenCalledOnce();

    window.removeEventListener("pos:pwa-apply-update", applyUpdate);
  });

  it("requests the update immediately from a safe route", () => {
    const applyUpdate = vi.fn();
    window.addEventListener("pos:pwa-apply-update", applyUpdate);
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <PWAUpdatePrompt />
      </MemoryRouter>,
    );

    act(() => window.dispatchEvent(new CustomEvent("pos:pwa-update-available")));
    fireEvent.click(screen.getByRole("button", { name: copy.pwaUpdate.update }));

    expect(applyUpdate).toHaveBeenCalledOnce();

    window.removeEventListener("pos:pwa-apply-update", applyUpdate);
  });
});
