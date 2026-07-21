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

    // The $186 sale stays traceable across the four live previews, which are
    // all mounted (stacked layers) in their final static state.
    expect(screen.getByText("Cobrar $186.00")).toBeInTheDocument(); // POS
    expect(screen.getByAltText("Vista real sanitizada del inventario de Kova")).toHaveAttribute("src", "/showcase/inventory.png");
    expect(screen.getByAltText("Vista real sanitizada de turnos en Kova")).toHaveAttribute("src", "/showcase/shifts.png");
    expect(screen.getByAltText("Vista real sanitizada de reportes en Kova")).toHaveAttribute("src", "/showcase/reports.png");

    // Reduced motion: parked on scene 1, no decorative cursor.
    expect(screenLayers(container)[0]).toHaveAttribute("data-active", "true");
    expect(container.querySelector(".ksw-cursor")).toBeNull();
  });

  it("wraps every preview scene in the real app-shell replica", () => {
    stubReducedMotion();
    const { container } = renderShowcase();

    // Una réplica por escena de preview (la CTA no lleva frame), cada una con
    // el nav completo del rol owner en el orden del AppShell real.
    const frames = container.querySelectorAll(".ksw-app");
    expect(frames).toHaveLength(4);
    const firstNavLabels = Array.from(
      frames[0].querySelectorAll(".ksw-app-nav-item"),
    ).map((el) => el.textContent);
    expect(firstNavLabels).toEqual([
      "Panel",
      "Caja",
      "Catálogo",
      "Órdenes",
      "Inventario",
      "Turnos",
      "Reportes",
      "Configuración",
      "Facturación",
    ]);

    // El item activo del sidebar sigue a la escena: POS → Caja,
    // inventario → Inventario, caja → Turnos, reportes → Reportes.
    const activeByFrame = Array.from(frames).map(
      (frame) => frame.querySelector('.ksw-app-nav-item[data-active="true"]')?.textContent,
    );
    expect(activeByFrame).toEqual(["Caja", "Inventario", "Turnos", "Reportes"]);
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
