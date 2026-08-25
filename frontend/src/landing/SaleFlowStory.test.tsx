import { fireEvent, render, screen, within } from "@testing-library/react";
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
    const saleTab = screen.getByRole("tab", { name: "Venta" });
    expect(saleTab).toHaveAttribute("aria-selected", "true");
    expect(within(saleTab).getByText("Venta registrada")).toBeVisible();
    expect(
      screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0),
    ).toEqual([saleTab]);
    expect(
      screen.getAllByRole("heading", { name: "Cobras en segundos." })[0],
    ).toBeVisible();
    expect(
      screen.getAllByRole("img", { name: /venta lista para cobrarse/i })[0],
    ).toHaveAttribute("src", "/showcase/sale-register.jpeg");
    expect(onStepView).toHaveBeenCalledWith("sale", "scroll");
  });

  it("lets the visitor select a step and exposes its real capture", () => {
    renderStory();

    fireEvent.click(screen.getByRole("tab", { name: "Inventario" }));

    expect(screen.getByRole("tab", { name: "Inventario" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getAllByRole("heading", {
        name: "El stock baja automáticamente.",
      })[0],
    ).toBeVisible();
    expect(
      screen.getAllByRole("img", { name: /Inventario de Kova/i })[0],
    ).toHaveAttribute("src", "/showcase/inventory-story.jpeg");
    expect(onStepView).toHaveBeenCalledWith("inventory", "control");
  });

  it("provides art-directed mobile captures for every story step", () => {
    const { container } = renderStory();

    const mobileSources = Array.from(
      container.querySelectorAll("picture source[media='(max-width: 900px)']"),
    );

    expect(mobileSources).toHaveLength(4);
    expect(mobileSources.map((source) => source.getAttribute("srcset"))).toEqual([
      "/showcase/sale-register-mobile.webp",
      "/showcase/inventory-story-mobile.webp",
      "/showcase/shifts-mobile.webp",
      "/showcase/analysis-story-mobile.webp",
    ]);
    expect(
      container.querySelectorAll("picture img[width='640'][height='400']"),
    ).toHaveLength(4);
  });

  it("supports arrow, Home and End keyboard navigation", () => {
    renderStory();
    const sale = screen.getByRole("tab", { name: "Venta" });

    fireEvent.keyDown(sale, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Inventario" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Inventario" }), {
      key: "End",
    });
    expect(screen.getByRole("tab", { name: "Análisis" })).toHaveFocus();
    expect(
      screen.getAllByRole("img", { name: /Análisis de Kova/i })[0],
    ).toHaveAttribute("src", "/showcase/analysis-story.jpeg");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Análisis" }), {
      key: "Home",
    });
    expect(screen.getByRole("tab", { name: "Venta" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Venta" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("tab", { name: "Análisis" })).toHaveFocus();
  });

  it("uses the signup destination for the story CTA", () => {
    renderStory();
    const cta = screen.getByRole("link", { name: "Probar Kova gratis" });
    expect(cta).toHaveAttribute("href", "/signup");
    fireEvent.click(cta);
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});
