import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { copy } from "@/i18n/messages";

import ProductFilm from "./ProductFilm";

const f = copy.landing.film;

function renderFilm(props: Parameters<typeof ProductFilm>[0] = {}) {
  return render(
    <MemoryRouter>
      <ProductFilm {...props} />
    </MemoryRouter>,
  );
}

describe("ProductFilm", () => {
  // jsdom implements neither matchMedia nor canvas, which is the same shape as
  // a prerender pass or a browser that cannot run the sequence. The section
  // must still be a complete piece of content.
  it("renders the section without a canvas runtime", () => {
    renderFilm();
    expect(screen.getByRole("heading", { name: f.title })).toBeVisible();
    expect(screen.getByText(f.line)).toBeVisible();
    expect(screen.getByText(f.note)).toBeVisible();
  });

  it("ships the poster as real content so the fallback is never blank", () => {
    renderFilm();
    const poster = screen.getByAltText(f.posterAlt);
    expect(poster).toBeVisible();
    expect(poster.getAttribute("src")).toMatch(/^\/film\/desktop\/frame-\d{4}\.webp$/);
  });

  it("names every chapter of the walkthrough", () => {
    renderFilm();
    for (const chapter of Object.values(f.chapters)) {
      expect(screen.getByText(chapter.title)).toBeInTheDocument();
      expect(screen.getByText(chapter.line)).toBeInTheDocument();
    }
  });

  it("points the CTA at the caller's destination", () => {
    renderFilm({ ctaTarget: "/signup?plan=pro" });
    const cta = screen.getByRole("link", { name: copy.landing.showcase.ctaButton });
    expect(cta).toHaveAttribute("href", "/signup?plan=pro");
  });
});
