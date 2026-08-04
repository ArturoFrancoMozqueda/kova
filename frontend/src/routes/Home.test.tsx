import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackAnonymousEvent = vi.fn();
const trackAnonymousEventOnce = vi.fn();

vi.mock("@/telemetry/funnel", () => ({
  trackAnonymousEvent: (...args: unknown[]) => trackAnonymousEvent(...args),
  trackAnonymousEventOnce: (...args: unknown[]) => trackAnonymousEventOnce(...args),
}));

// Unauthenticated visitor → primary CTAs point to /signup.
vi.mock("@/auth/useAuth", () => ({
  useAuth: () => ({ state: { status: "unauthenticated" } }),
}));

import Home from "./Home";

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

describe("landing telemetry (PLAN-UX-03)", () => {
  beforeEach(() => {
    trackAnonymousEvent.mockClear();
    trackAnonymousEventOnce.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("fires landing_viewed once on mount", () => {
    renderHome();
    expect(trackAnonymousEventOnce).toHaveBeenCalledWith("landing_viewed", "landing_viewed");
    expect(trackAnonymousEventOnce).toHaveBeenCalledWith(
      "story:sale",
      "landing_story_step_viewed",
      { step: "sale", trigger: "scroll" },
    );
  });

  it("fires landing_section_viewed per section as sections intersect", () => {
    // jsdom has no IntersectionObserver; this stub reports every observed
    // target as intersecting immediately, so the scroll-depth effect fires
    // for all sections on mount.
    class ImmediateIntersectionObserver {
      private callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);

    renderHome();

    const viewedSections = trackAnonymousEventOnce.mock.calls
      .filter(([, eventName]) => eventName === "landing_section_viewed")
      .map(([, , props]) => (props as { section: string }).section);
    expect(viewedSections).toEqual(
      expect.arrayContaining([
        "problema",
        "beneficios",
        "producto",
        "reportes",
        "comercios",
        "clientes",
        "valor",
        "precio",
        "faq",
        "cta-final",
      ]),
    );
  });

  it("fires landing_cta_clicked and signup_started when a primary CTA is clicked", () => {
    renderHome();

    const signupLink = screen
      .getAllByRole("link")
      .find((el) => el.getAttribute("href") === "/signup");
    expect(signupLink).toBeDefined();

    fireEvent.click(signupLink!);

    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      expect.objectContaining({ cta: expect.any(String) }),
    );
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "signup_started",
      expect.objectContaining({ cta: expect.any(String) }),
    );
  });

  it("keeps the stable primary CTA after pausing EXP-01", async () => {
    renderHome();

    const heroCta = await screen.findAllByRole("link", {
      name: /Probar Kova gratis/i,
    });
    expect(heroCta[0]).toHaveAttribute("href", "/signup");
    fireEvent.click(heroCta[0]);
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      { cta: "hero" },
    );
  });

  it("keeps hero copy outside the reveal gate used below the fold", () => {
    const { container } = renderHome();
    expect(container.querySelector(".lp-hero-grid")).not.toHaveAttribute("data-lp-reveal");
    expect(container.querySelector(".lp-hero-copy")).toBeVisible();
  });

  it("renders the conversion narrative in the intended order with one h1", () => {
    const { container } = renderHome();
    const sections = Array.from(container.querySelectorAll("main > section"));
    const sectionIds = sections.map((section) => section.id).filter(Boolean);

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Vende. Kova mantiene el resto bajo control.",
    );
    expect(sectionIds).toEqual([
      "problema",
      "beneficios",
      "producto",
      "reportes",
      "comercios",
      "clientes",
      "valor",
      "precio",
      "faq",
      "cta-final",
    ]);
  });

  it("uses only insights visible in the real reports capture", () => {
    renderHome();

    expect(screen.getByText("$564.00")).toBeInTheDocument();
    expect(screen.getByText("Cold brew")).toBeInTheDocument();
    expect(screen.getByText("19:00–20:00")).toBeInTheDocument();
    expect(screen.getByText("$112.80")).toBeInTheDocument();
    expect(screen.getByAltText(/Reportes de Kova con ventas netas/i)).toHaveAttribute(
      "loading",
      "lazy",
    );
  });

  it("tracks the story CTA at the same signup destination", () => {
    const { container } = renderHome();
    const cta = container.querySelector<HTMLAnchorElement>(
      '#producto a[href="/signup"]',
    );
    expect(cta).not.toBeNull();
    fireEvent.click(cta!);
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      { cta: "story" },
    );
  });
});
