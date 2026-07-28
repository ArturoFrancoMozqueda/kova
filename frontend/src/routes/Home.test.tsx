import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackAnonymousEvent = vi.fn();
const trackAnonymousEventOnce = vi.fn();
const trackExperimentExposed = vi.fn();
const assignCtaSpecificityExperiment = vi.fn();

vi.mock("@/telemetry/funnel", () => ({
  trackAnonymousEvent: (...args: unknown[]) => trackAnonymousEvent(...args),
  trackAnonymousEventOnce: (...args: unknown[]) => trackAnonymousEventOnce(...args),
  trackExperimentExposed: (...args: unknown[]) => trackExperimentExposed(...args),
  assignCtaSpecificityExperiment: (...args: unknown[]) =>
    assignCtaSpecificityExperiment(...args),
  hasFunnelClientId: () => false,
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
    trackExperimentExposed.mockClear();
    assignCtaSpecificityExperiment.mockReset();
    assignCtaSpecificityExperiment.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("fires landing_viewed once on mount", () => {
    renderHome();
    expect(trackAnonymousEventOnce).toHaveBeenCalledWith("landing_viewed", "landing_viewed");
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
        "producto",
        // La historia de la venta ($186 trazable) es sección propia desde el
        // rediseño narrativo: noveno datapoint de scroll-depth.
        "una-venta",
        "problema",
        "panel-dueno",
        "como-funciona",
        // "¿Es para mí?" es sección real (#comercios) desde el rediseño CRO;
        // antes era un ancla escondida dentro del bento.
        "comercios",
        "diferencia",
        "faq",
        "precio",
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

  it("shows the verified trial treatment and records one EXP-01 exposure", async () => {
    assignCtaSpecificityExperiment.mockReturnValue("treatment");
    renderHome();

    const treatmentCta = await screen.findByRole("link", {
      name: /Prueba Kova 7 días gratis/i,
    });
    expect(treatmentCta).toHaveAttribute("href", "/signup");
    await waitFor(() => {
      expect(trackExperimentExposed).toHaveBeenCalledWith(
        "exp_01_cta_specificity",
        "treatment",
        "hero",
      );
    });
    fireEvent.click(treatmentCta);
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      {
        cta: "hero",
        experiment_id: "exp_01_cta_specificity",
        variant: "treatment",
      },
    );
  });

  it("keeps hero copy outside the reveal gate used below the fold", () => {
    const { container } = renderHome();
    expect(container.querySelector(".lp-hero-grid")).not.toHaveAttribute("data-lp-reveal");
    expect(container.querySelector(".lp-hero-copy")).toBeVisible();
  });

  // The embedded walkthrough is now ProductFilm rather than KovaShowcase, so
  // the selector moved. The contract under test is unchanged: the product
  // section carries a signup CTA that reports itself as "showcase".
  it("tracks the embedded showcase CTA at the same signup destination", () => {
    const { container } = renderHome();
    const cta = container.querySelector<HTMLAnchorElement>(
      '.pf-cta[href="/signup"]',
    );
    expect(cta).not.toBeNull();
    fireEvent.click(cta!);
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      { cta: "showcase" },
    );
  });
});
