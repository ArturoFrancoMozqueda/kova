import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import KovaShowcase from "./KovaShowcase";

// jsdom no trae matchMedia ni IntersectionObserver. Sin ellos, el director
// asume in-view + sin reduced-motion (guards internos), así que el loop corre
// con fake timers. Para las pruebas de contenido estático se stubbea
// matchMedia con prefers-reduced-motion: los previews muestran sus valores
// finales de inmediato y el director queda estacionado en la escena 1.

function renderShowcase() {
  return render(
    <MemoryRouter>
      <KovaShowcase format="landscape" />
    </MemoryRouter>,
  );
}

function stubReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

function screenLayers(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".ksw-screen-layer"));
}

describe("KovaShowcase", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the whole story statically under reduced motion (prerender-shaped HTML)", () => {
    stubReducedMotion();
    const { container } = renderShowcase();

    // CTA layer always in the DOM — scripts/prerender.mjs asserts this string
    // in the SSR output of "/".
    expect(screen.getByText("Deja de adivinar.")).toBeInTheDocument();
    expect(container.querySelector('a[href="/signup"]')).not.toBeNull();

    // The four story captions (same copy as landing story.steps).
    for (const title of ["Cobras", "El stock baja", "La caja cuadra", "Ves el día completo"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }

    // The local $186 demo and the three real captures are all mounted as
    // stacked layers in their final static state.
    expect(screen.getByText("Cobrar $186.00")).toBeInTheDocument(); // POS
    expect(screen.getByAltText("Vista real sanitizada del inventario de Kova")).toHaveAttribute("src", "/showcase/inventory.png");
    expect(screen.getByAltText("Vista real sanitizada de turnos en Kova")).toHaveAttribute("src", "/showcase/shifts.png");
    expect(screen.getByAltText("Vista real sanitizada de análisis en Kova")).toHaveAttribute("src", "/showcase/reports.png");

    // Reduced motion: parked on scene 1, no decorative cursor.
    expect(screenLayers(container)[0]).toHaveAttribute("data-active", "true");
    expect(container.querySelector(".ksw-cursor")).toBeNull();
  });

  it("distinguishes the local demo from full real-product captures", () => {
    stubReducedMotion();
    const { container } = renderShowcase();

    expect(screen.getByText("Demo interactiva")).toBeInTheDocument();
    expect(screen.getByText("Pruébala con datos locales. No registra ventas.")).toBeInTheDocument();
    expect(container.querySelector(".ksw-app")).toBeNull();
    expect(container.querySelectorAll(".ksw-capture-surface img")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "02 El stock baja" }));
    expect(screen.getByText("Vista real del producto")).toBeInTheDocument();
    expect(screen.getByText("Captura sanitizada del tenant productivo.")).toBeInTheDocument();
  });

  it("uses the host CTA destination and reports embedded clicks", () => {
    stubReducedMotion();
    const onCtaClick = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <KovaShowcase
          format="landscape"
          ctaTarget="/dashboard"
          onCtaClick={onCtaClick}
        />
      </MemoryRouter>,
    );

    const cta = container.querySelector<HTMLAnchorElement>('a[href="/dashboard"]');
    expect(cta).not.toBeNull();
    fireEvent.click(cta!);
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });

  it("advances scenes every 6s and loops back after five", () => {
    vi.useFakeTimers();
    const { container } = renderShowcase();
    const layers = screenLayers(container);
    expect(layers).toHaveLength(5);

    // Scene 1 (POS) active, with the decorative cursor mounted.
    expect(layers[0]).toHaveAttribute("data-active", "true");
    expect(layers[1]).toHaveAttribute("data-active", "false");
    expect(container.querySelector(".ksw-cursor")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(layers[0]).toHaveAttribute("data-active", "false");
    expect(layers[1]).toHaveAttribute("data-active", "true");
    expect(container.querySelector(".ksw-cursor")).toBeNull();

    // Four more slots → full 30s loop lands back on scene 1.
    act(() => {
      vi.advanceTimersByTime(4 * 6000);
    });
    expect(layers[0]).toHaveAttribute("data-active", "true");
  });

  it("never starts the loop under reduced motion", () => {
    stubReducedMotion();
    vi.useFakeTimers();
    const { container } = renderShowcase();

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    const layers = screenLayers(container);
    expect(layers[0]).toHaveAttribute("data-active", "true");
    expect(layers[1]).toHaveAttribute("data-active", "false");
    expect(container.querySelector(".ksw-cursor")).toBeNull();
  });

  it("lets the visitor select a scene and stops autoplay after manual control", () => {
    vi.useFakeTimers();
    const { container } = renderShowcase();
    fireEvent.click(screen.getByRole("button", { name: "02 El stock baja" }));
    const layers = screenLayers(container);
    expect(layers[1]).toHaveAttribute("data-active", "true");
    act(() => vi.advanceTimersByTime(12000));
    expect(layers[1]).toHaveAttribute("data-active", "true");
  });
});
