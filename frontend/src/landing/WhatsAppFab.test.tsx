import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trackAnonymousEvent = vi.fn();
vi.mock("@/telemetry/funnel", () => ({
  trackAnonymousEvent: (...args: unknown[]) => trackAnonymousEvent(...args),
}));

// Mock mutable del canal: cada test decide si hay número configurado.
let enabled = false;
vi.mock("@/lib/whatsapp", () => ({
  isWhatsAppEnabled: () => enabled,
  whatsAppLink: (message: string) =>
    `https://wa.me/5215512345678?text=${encodeURIComponent(message)}`,
}));

import WhatsAppFab from "./WhatsAppFab";

describe("WhatsAppFab", () => {
  beforeEach(() => {
    trackAnonymousEvent.mockClear();
  });

  it("renders nothing while no phone is configured (production default)", () => {
    enabled = false;
    const { container } = render(<WhatsAppFab />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a safe wa.me link when configured", () => {
    enabled = true;
    const { container } = render(<WhatsAppFab />);
    const link = container.querySelector<HTMLAnchorElement>("a.lp-wa-fab");
    expect(link).not.toBeNull();
    expect(link!.href).toContain("https://wa.me/5215512345678?text=");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link!.getAttribute("target")).toBe("_blank");
    // Nace oculto: solo se muestra al pasar el hero-film.
    expect(link!.getAttribute("data-visible")).toBe("false");
  });

  it("reports landing_cta_clicked and never signup_started on click", () => {
    enabled = true;
    const { container } = render(<WhatsAppFab />);
    fireEvent.click(container.querySelector("a.lp-wa-fab")!);
    expect(trackAnonymousEvent).toHaveBeenCalledWith("landing_cta_clicked", {
      cta: "whatsapp_fab",
      placement: "fab",
    });
    const eventNames = trackAnonymousEvent.mock.calls.map(([name]) => name);
    expect(eventNames).not.toContain("signup_started");
  });
});
