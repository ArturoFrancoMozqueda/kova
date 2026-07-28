import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SaleFlowStory from "./SaleFlowStory";

describe("SaleFlowStory", () => {
  const onCtaClick = vi.fn();
  const onStepView = vi.fn();
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    onCtaClick.mockClear();
    onStepView.mockClear();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderStory() {
    return render(
      <MemoryRouter>
        <SaleFlowStory
          primaryTarget="/signup"
          onCtaClick={onCtaClick}
          onStepView={onStepView}
        />
      </MemoryRouter>,
    );
  }

  it("renders the complete four-step story in document order", () => {
    renderStory();

    expect(screen.getByRole("heading", { name: "Cobras $186" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "El stock responde" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "La caja se explica" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "El día toma forma" })).toBeInTheDocument();
    expect(onStepView).toHaveBeenCalledWith("sale", "scroll");
  });

  it("uses sanitized captures of the real product instead of reconstructed previews", () => {
    renderStory();

    expect(screen.getAllByRole("img", { name: /Caja real de Kova/ })[0]).toHaveAttribute(
      "src",
      "/showcase/register.png",
    );
    expect(screen.getAllByRole("img", { name: /Inventario real de Kova/ })[0]).toHaveAttribute(
      "src",
      "/showcase/inventory.png",
    );
    expect(screen.getAllByRole("img", { name: /Turnos reales de Kova/ })[0]).toHaveAttribute(
      "src",
      "/showcase/shifts.png",
    );
    expect(screen.getAllByRole("img", { name: /Reportes reales de Kova/ })[0]).toHaveAttribute(
      "src",
      "/showcase/reports.png",
    );
  });

  it("lets the visitor select a step without autoplay", () => {
    renderStory();

    fireEvent.click(screen.getByRole("button", { name: "02 El stock responde" }));

    expect(onStepView).toHaveBeenCalledWith("inventory", "control");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("uses instant scrolling when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    renderStory();
    fireEvent.click(screen.getByRole("button", { name: "03 La caja se explica" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
  });

  it("uses the signup destination for the story CTA", () => {
    renderStory();
    const cta = screen.getByRole("link", { name: "Empieza gratis" });
    expect(cta).toHaveAttribute("href", "/signup");
    fireEvent.click(cta);
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});
