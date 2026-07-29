import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { copy } from "@/i18n/messages";
import StickyCta from "./StickyCta";

function renderBar(props: Partial<Parameters<typeof StickyCta>[0]> = {}) {
  const onCtaClick = vi.fn();
  const utils = render(
    <MemoryRouter>
      <StickyCta
        primaryTarget="/signup"
        isAuthenticated={false}
        onCtaClick={onCtaClick}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onCtaClick };
}

describe("StickyCta", () => {
  it("renders nothing by default (hidden until the scroll rules apply)", () => {
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it("restates the offer and reports sticky_mobile on click", () => {
    const { container, onCtaClick, getByText } = renderBar({ initiallyVisible: true });
    // La oferta re-enunciada: precio + trial, y el CTA estable del hero.
    expect(getByText(copy.landing.stickyCta.note)).toBeInTheDocument();
    const link = container.querySelector<HTMLAnchorElement>('a[href="/signup"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent(copy.landing.hero.ctaPrimary);
    // Contrato e2e del film: la barra jamás usa la clase .pf-cta.
    expect(container.querySelector(".pf-cta")).toBeNull();
    fireEvent.click(link!);
    expect(onCtaClick).toHaveBeenCalledWith("sticky_mobile");
  });

  it("stays hidden for authenticated visitors even if forced visible", () => {
    const { container } = renderBar({ isAuthenticated: true, initiallyVisible: false });
    expect(container.innerHTML).toBe("");
  });
});
