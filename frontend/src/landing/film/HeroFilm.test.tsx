// Migrado de ProductFilm.test.tsx: el film se fusionó con el hero (HeroFilm),
// así que los contratos de sección (H2 propio del film) se sustituyen por los
// del hero (H1, .lp-hero-copy, modo estático completo). El resto de los
// contratos — póster real, capítulos nombrados, CTA del outro — se conserva.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { copy } from "@/i18n/messages";

import HeroFilm from "./HeroFilm";

const f = copy.landing.film;
const h = copy.landing.hero;

function renderFilm(overrides: Partial<Parameters<typeof HeroFilm>[0]> = {}) {
  const onPrimaryCta = vi.fn();
  const utils = render(
    <MemoryRouter>
      <HeroFilm
        primaryTarget="/signup"
        primaryCtaLabel={h.ctaPrimary}
        onPrimaryCta={onPrimaryCta}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { ...utils, onPrimaryCta };
}

describe("HeroFilm", () => {
  // jsdom no implementa matchMedia ni canvas — la misma forma que tiene el
  // prerender o un navegador que no puede correr el scrub. El modo estático
  // debe ser un hero completo, nunca contenido oculto.
  it("renders the complete static hero without a canvas runtime", () => {
    const { container } = renderFilm();
    expect(
      screen.getByRole("heading", { level: 1, name: h.title }),
    ).toBeVisible();
    expect(container.querySelector(".lp-hero-copy")).toBeVisible();
    expect(container.querySelector(".lp-hero-grid")).not.toHaveAttribute("data-lp-reveal");
    expect(screen.getByText(f.note)).toBeVisible();
    // El modo cinemático es opt-in post-hidratación; jsdom nunca lo activa.
    expect(container.querySelector("section#producto")).not.toHaveAttribute("data-pf-live");
  });

  it("ships the poster as real content so the fallback is never blank", () => {
    renderFilm();
    const poster = screen.getByAltText(f.posterAlt);
    expect(poster).toBeVisible();
    expect(poster.getAttribute("src")).toMatch(/^\/film\/desktop\/frame-\d{4}\.webp$/);
    expect(poster.getAttribute("fetchpriority")).toBe("high");
  });

  it("names every chapter of the walkthrough statically", () => {
    renderFilm();
    for (const chapter of Object.values(f.chapters)) {
      expect(screen.getByText(chapter.title)).toBeInTheDocument();
      expect(screen.getByText(chapter.line)).toBeInTheDocument();
    }
  });

  it("wires the primary hero CTA to the caller's handler and target", () => {
    const { container, onPrimaryCta } = renderFilm();
    const actions = container.querySelector(".lp-hero-actions");
    const cta = actions?.querySelector<HTMLAnchorElement>('a[href="/signup"]');
    expect(cta).not.toBeNull();
    expect(cta).toHaveTextContent(h.ctaPrimary);
    fireEvent.click(cta!);
    expect(onPrimaryCta).toHaveBeenCalledTimes(1);
  });

  it("keeps the outro CTA pointing at the caller's destination", () => {
    // Por clase y no por nombre accesible: el CTA del hero comparte label
    // ("Empieza gratis") con el del outro — mismo destino, mismo texto.
    const { container } = renderFilm({ ctaTarget: "/signup?plan=pro" });
    const cta = container.querySelector<HTMLAnchorElement>(".pf-cta");
    expect(cta).not.toBeNull();
    expect(cta).toHaveTextContent(copy.landing.showcase.ctaButton);
    expect(cta).toHaveAttribute("href", "/signup?plan=pro");
  });
});
