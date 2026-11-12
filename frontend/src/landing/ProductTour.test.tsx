import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductTour from "./ProductTour";

class VisibleIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, intersectionRatio: 0.6, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "0px";
  thresholds = [0, 0.3, 0.6];
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

describe("ProductTour", () => {
  const onCtaClick = vi.fn();
  const onStepView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onCtaClick.mockClear();
    onStepView.mockClear();
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderTour() {
    return render(
      <MemoryRouter>
        <ProductTour primaryTarget="/signup" onCtaClick={onCtaClick} onStepView={onStepView} />
      </MemoryRouter>,
    );
  }

  it("starts on the sale step, tracks the view and shows the local register demo", () => {
    renderTour();
    expect(screen.getByRole("tab", { name: /Cobras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Carrito");
    expect(onStepView).toHaveBeenCalledWith("sale", "scroll");
    expect(screen.getByText("Demostración con datos de ejemplo: no registra ventas.")).toBeInTheDocument();
  });

  it("advances on its own while visible and stops once the visitor picks a step", () => {
    renderTour();
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByRole("tab", { name: /Baja el inventario/ })).toHaveAttribute("aria-selected", "true");
    expect(onStepView).toHaveBeenCalledWith("inventory", "scroll");

    fireEvent.click(screen.getByRole("tab", { name: /Cuadra el turno/ }));
    expect(onStepView).toHaveBeenCalledWith("cash", "control");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Efectivo esperado");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("$2,040.00");

    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByRole("tab", { name: /Cuadra el turno/ })).toHaveAttribute("aria-selected", "true");
  });

  it("lets the visitor pause the tour", () => {
    renderTour();
    fireEvent.click(screen.getByRole("button", { name: "Pausar recorrido" }));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByRole("tab", { name: /Cobras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Reproducir recorrido" })).toBeInTheDocument();
  });

  it("moves between steps with the arrow keys", () => {
    renderTour();
    const first = screen.getByRole("tab", { name: /Cobras/ });
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    const last = screen.getByRole("tab", { name: /Entiendes el día/ });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(last).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Ventas netas");
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("never moves on its own under reduced motion", () => {
    stubReducedMotion(true);
    renderTour();
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByRole("tab", { name: /Cobras/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Pausar recorrido" })).toBeNull();
  });

  it("keeps the signup CTA on the same tracked destination", () => {
    renderTour();
    const cta = screen.getByRole("link", { name: "Probar Kova gratis" });
    expect(cta).toHaveAttribute("href", "/signup");
    fireEvent.click(cta);
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});
