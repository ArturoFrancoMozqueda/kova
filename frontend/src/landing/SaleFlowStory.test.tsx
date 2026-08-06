import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SaleFlowStory from "./SaleFlowStory";

describe("SaleFlowStory", () => {
  const onCtaClick = vi.fn();
  const onStepView = vi.fn();

  beforeEach(() => {
    onCtaClick.mockClear();
    onStepView.mockClear();
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

  it("renders four accessible tabs without autoplay", () => {
    renderStory();

    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Venta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("heading", { name: "Cobras en segundos." })[0]).toBeVisible();
    expect(onStepView).toHaveBeenCalledWith("sale", "scroll");
  });

  it("lets the visitor select a step and exposes its real capture", () => {
    renderStory();

    fireEvent.click(screen.getByRole("tab", { name: "Inventario" }));

    expect(screen.getByRole("tab", { name: "Inventario" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("heading", { name: "El stock baja automáticamente." })[0]).toBeVisible();
    expect(screen.getAllByRole("img", { name: /Inventario de Kova/i })[0]).toBeVisible();
    expect(onStepView).toHaveBeenCalledWith("inventory", "control");
  });

  it("supports arrow, Home and End keyboard navigation", () => {
    renderStory();
    const sale = screen.getByRole("tab", { name: "Venta" });

    fireEvent.keyDown(sale, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Inventario" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Inventario" }), {
      key: "End",
    });
    expect(screen.getByRole("tab", { name: "Reportes" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Reportes" }), {
      key: "Home",
    });
    expect(screen.getByRole("tab", { name: "Venta" })).toHaveFocus();
  });

  it("uses the signup destination for the story CTA", () => {
    renderStory();
    const cta = screen.getByRole("link", { name: "Probar Kova gratis" });
    expect(cta).toHaveAttribute("href", "/signup");
    fireEvent.click(cta);
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});
