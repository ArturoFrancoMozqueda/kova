import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GuidedProductStory from "./GuidedProductStory";

// jsdom no implementa matchMedia ni IntersectionObserver: el componente cae
// en la rama desktop (tablist + stage) y las micros corren con rAF, por lo
// que los montos finales se esperan con findByText.

describe("GuidedProductStory", () => {
  it("renders the 4-step tablist with the POS state active", async () => {
    render(<GuidedProductStory />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Cobrar $186.00", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Cobras en segundos.")).toBeInTheDocument();
  });

  it("keeps the $186 sale traceable across the four states", async () => {
    render(<GuidedProductStory />);

    fireEvent.click(screen.getByRole("tab", { name: /el stock baja/i }));
    expect(await screen.findByText("Stock bajo")).toBeInTheDocument();
    expect(screen.getByText(/Riesgo de agotarse/)).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
    expect(screen.getByText("El stock se actualiza solo.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /la caja cuadra/i }));
    expect(screen.getByText("Turno activo")).toBeInTheDocument();
    expect(screen.getByText("+$186.00")).toBeInTheDocument();
    expect(await screen.findByText("$2,040.00", {}, { timeout: 3000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /tú entiendes/i }));
    expect(screen.getByText("Cómo te pagaron")).toBeInTheDocument();
    expect(await screen.findByText("$4,820.00", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/1\. Latte Vainilla/)).toBeInTheDocument();
    expect(screen.getByText("Y tú entiendes qué pasó.")).toBeInTheDocument();
  });

  it("supports arrow-key navigation on the tablist", () => {
    render(<GuidedProductStory />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: /el stock baja/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: /tú entiendes/i })).toHaveAttribute("aria-selected", "true");
  });
});
