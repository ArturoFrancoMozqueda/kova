import type { PublicPlansState } from "@/billing/publicPlans";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Oferta vigente del catálogo público (backend/app/billing/plans.py).
const CURRENT_OFFER = vi.hoisted(() => {
  const core = ["pos", "inventory", "sales_reports", "public_catalog"];
  return { status: "ready", catalog: { offer_revision: "tiered", tiered_pricing_enabled: true, available_plans: [
    { code: "esencial", name: "Esencial", amount_minor_units: 39900, currency: "MXN", interval: "month", tax_inclusive: true, features: core, limits: { product_image_bytes: 250_000_000, branches: 1 } },
    { code: "gestion", name: "Gestión", amount_minor_units: 69900, currency: "MXN", interval: "month", tax_inclusive: true, features: [...core, "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"], limits: { product_image_bytes: 1_073_741_824, branches: 1 } },
  ] } } as PublicPlansState;
});
const publicOffer = vi.hoisted(() => ({ state: null as unknown as PublicPlansState }));
vi.mock("@/billing/publicPlans", async (importOriginal) => ({ ...await importOriginal<typeof import("@/billing/publicPlans")>(), usePublicPlans: () => ({ ...publicOffer.state, retry: vi.fn() }) }));
const trackAnonymousEvent = vi.fn();
const trackAnonymousEventOnce = vi.fn();

vi.mock("@/telemetry/funnel", () => ({
  trackAnonymousEvent: (...args: unknown[]) => trackAnonymousEvent(...args),
  trackAnonymousEventOnce: (...args: unknown[]) =>
    trackAnonymousEventOnce(...args),
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
    publicOffer.state = CURRENT_OFFER;
    trackAnonymousEvent.mockClear();
    trackAnonymousEventOnce.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("fires landing_viewed once on mount", () => {
    renderHome();
    expect(trackAnonymousEventOnce).toHaveBeenCalledWith(
      "landing_viewed",
      "landing_viewed",
    );
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
        "clientes",
        "problema",
        "producto",
        "incluye",
        "reportes",
        "clientes",
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
    expect(trackAnonymousEvent).toHaveBeenCalledWith("landing_cta_clicked", {
      cta: "hero",
    });
  });

  it("keeps hero copy outside the reveal gate used below the fold", () => {
    const { container } = renderHome();
    expect(container.querySelector(".lp-hero-grid")).not.toHaveAttribute(
      "data-lp-reveal",
    );
    expect(container.querySelector(".lp-hero-copy")).toBeVisible();
  });

  it("restores the public page title after returning from another screen", () => {
    document.title = "Iniciar sesión · Kova";
    renderHome();
    expect(document.title).toBe("Kova | Punto de venta e inventario para negocios en México");
  });

  it("makes the skip link destination focusable without adding a tab stop", () => {
    renderHome();
    expect(screen.getByRole("link", { name: "Ir al contenido" })).toHaveAttribute("href", "#contenido-principal");
    expect(screen.getByRole("main")).toHaveAttribute("id", "contenido-principal");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });

  it("renders the conversion narrative in the intended order with one h1", () => {
    const { container } = renderHome();
    const sections = Array.from(container.querySelectorAll("main > section"));
    const sectionIds = sections.map((section) => section.id).filter(Boolean);

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Cobra una vez. Kova cuadra el resto.",
    );
    expect(sectionIds).toEqual([
      "clientes",
      "problema",
      "producto",
      "incluye",
      "reportes",
      "precio",
      "faq",
      "cta-final",
    ]);
    expect(container.querySelector('a[href="#comercios"]')).toBeNull();
    expect(
      screen.getByText(
        /Gestión comercial y punto de venta para tu negocio/i,
      ),
    ).toBeVisible();
    expect(container.querySelector(".lp-hero-copy")).toHaveTextContent(
      /Cada venta descuenta tu inventario, entra a tu corte de caja/i,
    );
    expect(container.querySelectorAll(".lp-hero-bullets li")).toHaveLength(3);
  });

  it("contrasts each loose tool with the part of Kova that replaces it", () => {
    const { container } = renderHome();
    const problem = container.querySelector("#problema");
    const rows = problem?.querySelectorAll("ul > li");

    expect(rows).toHaveLength(6);
    expect(problem).toHaveTextContent("Libreta de ventas");
    expect(problem).toHaveTextContent("Calculadora al cierre");
    expect(problem).toHaveTextContent("Menú digital con QR y precios al día");
    // Sin precios de terceros inventados en el contraste.
    expect(problem?.textContent).not.toMatch(/\$\d/);
  });

  it("keeps social proof and capabilities inside verified product behavior", () => {
    const { container } = renderHome();
    const landingText = container.textContent ?? "";

    expect(landingText).not.toMatch(/sucursales/i);
    expect(landingText).not.toContain(
      "Negocios mexicanos ya operan todos los días con Kova.",
    );
    expect(screen.getByText("Decidir con datos")).toBeVisible();
    expect(screen.getByText("Trabajar desde cualquier equipo")).toBeVisible();
    expect(screen.getByText("Ventas sin internet")).toBeVisible();
    expect(screen.getByText("Turnos y corte")).toBeVisible();
    expect(screen.getByText("Menú digital con QR")).toBeVisible();
    expect(screen.getByText("Puntos y recompensas")).toBeVisible();
    // Proveedores externos que no están disponibles no se anuncian.
    expect(landingText).not.toMatch(/CFDI automático|timbra|terminal integrada|WhatsApp automático/i);
    expect(landingText).not.toMatch(/Plan Standard|299/);
    expect(landingText).not.toMatch(/≈\s*\$10/);
    expect(
      screen.getByRole("button", { name: "¿Kova funciona para mi negocio?" }),
    ).toBeVisible();
  });

  it("states the commercial limits at the decision point", () => {
    const { container } = renderHome();
    const landingText = container.textContent ?? "";

    expect(landingText).not.toContain("Beta privada controlada");
    expect(container.querySelector(".lp-hero-pricing")).toHaveTextContent(
      /Desde \$399 MXN\/mes\s*·\s*7 días gratis · Sin tarjeta/,
    );
    expect(container.querySelector("#cta-final")).toHaveTextContent(
      "7 días gratis · Sin tarjeta · Cancela cuando quieras",
    );
    expect(landingText).toContain("tarjeta manual");
    expect(
      screen.getByRole("button", { name: "¿Kova procesa cobros con tarjeta?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "¿Kova emite facturas o CFDI?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "¿Kova calcula IVA u otros impuestos?",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "¿Qué pasa cuando termina la prueba?",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "¿Puedo exportar mis datos si cancelo?",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "¿Cómo funciona el soporte durante la beta?",
      }),
    ).toBeVisible();
    expect(landingText).not.toMatch(/terminal integrada/i);
  });

  it("frames reports around grounded owner questions", () => {
    renderHome();

    expect(screen.getAllByText("¿Cuánto vendí?")).toHaveLength(1);
    expect(screen.getByText("¿Qué producto se mueve?")).toBeInTheDocument();
    expect(screen.getByText("¿Cuándo vendo más?")).toBeInTheDocument();
    expect(screen.getByText("¿Qué necesita atención?")).toBeInTheDocument();
    const analysisImage = screen.getByAltText(/Análisis de Kova con ventas netas/i);
    expect(analysisImage).toHaveAttribute("src", "/showcase/analysis-story.jpeg");
    expect(analysisImage).toHaveAttribute("width", "3196");
    expect(analysisImage).toHaveAttribute("height", "1811");
    expect(analysisImage).toHaveAttribute("loading", "lazy");
  });

  it("does not render decorative live or browser dots", () => {
    const { container } = renderHome();
    expect(container.querySelector(".lp-live-dot")).toBeNull();
    expect(container.textContent).not.toContain("● ● ●");
    expect(container.querySelector(".lp-hero-frame-bar")).toBeNull();
    expect(container.textContent).not.toMatch(
      /Captura real(?: del producto| de Reportes| sanitizada)/i,
    );
  });

  it("shows the Kova laptop and mobile product image in the hero", () => {
    renderHome();

    expect(
      screen.getByAltText(/Kova funcionando en una laptop y un teléfono/i),
    ).toHaveAttribute("src", "/showcase/kova-laptop-mobile.webp");
  });

  it("tracks the story CTA at the same signup destination", () => {
    const { container } = renderHome();
    const cta = container.querySelector<HTMLAnchorElement>(
      '#producto a[href="/signup"]',
    );
    expect(cta).not.toBeNull();
    fireEvent.click(cta!);
    expect(trackAnonymousEvent).toHaveBeenCalledWith("landing_cta_clicked", {
      cta: "story",
    });
  });
  it("does not announce an unconfirmed price when the public offer cannot be loaded", () => {
    publicOffer.state = { status: "error" };
    const { container } = renderHome();
    expect(container.textContent).not.toContain("299");
    expect(container.querySelector(".lp-hero-pricing")).toHaveTextContent(/^7 días gratis · Sin tarjeta$/);
    expect(container.querySelector("#incluye")?.textContent).not.toMatch(/Plan Gestión/);
    expect(screen.getByRole("button", { name: "Consultar planes de nuevo" })).toBeInTheDocument();
  });

  it("never advertises a single-plan catalog, even if the server returns one", () => {
    publicOffer.state = { status: "ready", catalog: { tiered_pricing_enabled: false, available_plans: [
      { code: "standard", name: "Plan Standard", amount_minor_units: 29900, currency: "MXN", interval: "month", tax_inclusive: null, features: [], limits: { product_image_bytes: null } },
    ] } };
    const { container } = renderHome();
    expect(container.textContent).not.toMatch(/Plan Standard|299/);
    expect(container.querySelector(".lp-hero-pricing")).toHaveTextContent(/^7 días gratis · Sin tarjeta$/);
    expect(container.querySelector("#incluye")?.textContent).not.toMatch(/Plan Gestión/);
    expect(screen.getByRole("button", { name: "Consultar planes de nuevo" })).toBeInTheDocument();
  });

  it("shows the Esencial and Gestión offer with prices, features and limits from the server", () => {
    const { container } = renderHome();
    expect(container.textContent).not.toContain("299");
    expect(screen.getByRole("heading", { name: "Esencial" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Gestión" })).toBeVisible();
    expect(screen.getByText("250 MB para fotos de productos")).toBeVisible();
    expect(screen.getByText("1 GiB para fotos de productos")).toBeVisible();
    expect(screen.getByText("$699 MXN/mes")).toBeVisible();
    expect(container.querySelector(".lp-hero-pricing")).toHaveTextContent("Desde $399 MXN/mes");
    expect(screen.getByText("Todo lo de Esencial, más:")).toBeVisible();
    expect(screen.getByText("Incluido en tu prueba")).toBeVisible();
    // Funciones que el plan de entrada no trae se etiquetan con el plan del servidor.
    const capabilities = container.querySelector("#incluye");
    expect(capabilities?.textContent).toContain("Plan Gestión");
    const reports = Array.from(capabilities?.querySelectorAll("li") ?? []).find((li) => li.textContent?.includes("Resumen de ventas"));
    expect(reports?.textContent).not.toContain("Plan Gestión");
    const analysis = Array.from(capabilities?.querySelectorAll("li") ?? []).find((li) => li.textContent?.includes("Análisis del negocio"));
    expect(analysis?.textContent).toContain("Plan Gestión");
  });

});
