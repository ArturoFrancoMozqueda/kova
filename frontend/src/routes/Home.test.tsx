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
import { TESTIMONIALS } from "@/landing/testimonials.data";
import { isWhatsAppEnabled } from "@/lib/whatsapp";

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

  // EXP-01 está en pausa aprobada (docs/experiments/EXPERIMENT-REGISTRY.md):
  // el CTA del hero queda estable en "Empieza gratis" y el payload del click
  // ya no lleva experiment_id/variant.
  it("keeps the stable primary CTA after pausing EXP-01", async () => {
    renderHome();

    const heroCtas = await screen.findAllByRole("link", {
      name: /Empieza gratis/i,
    });
    expect(heroCtas[0]).toHaveAttribute("href", "/signup");
    fireEvent.click(heroCtas[0]!);
    expect(trackAnonymousEvent).toHaveBeenCalledWith(
      "landing_cta_clicked",
      { cta: expect.any(String) },
    );
  });

  it("keeps hero copy outside the reveal gate used below the fold", () => {
    const { container } = renderHome();
    expect(container.querySelector(".lp-hero-grid")).not.toHaveAttribute("data-lp-reveal");
    expect(container.querySelector(".lp-hero-copy")).toBeVisible();
  });

  // Gating por datos/config: la sección #clientes y el canal de WhatsApp
  // existen exactamente cuando su fuente de verdad (testimonials.data.ts /
  // lib/whatsapp.ts) está configurada. El assert es dinámico para que el
  // contrato sobreviva si el usuario vacía o llena esa configuración.
  it("renders testimonials and WhatsApp UI exactly when configured", () => {
    const { container } = renderHome();
    expect(container.querySelectorAll("#clientes blockquote")).toHaveLength(TESTIMONIALS.length);
    const waLinks = container.querySelectorAll('a[href^="https://wa.me/"]');
    if (isWhatsAppEnabled()) {
      expect(container.querySelector(".lp-wa-fab")).not.toBeNull();
      // FAB + link del FAQ + link del footer.
      expect(waLinks).toHaveLength(3);
    } else {
      expect(container.querySelector(".lp-wa-fab")).toBeNull();
      expect(waLinks).toHaveLength(0);
    }
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
