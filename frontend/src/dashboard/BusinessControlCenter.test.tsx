import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { BusinessControlCenter } from "./BusinessControlCenter";

const destinations = [
  { to: "/register", label: "Caja" }, { to: "/orders", label: "Ventas" },
  { to: "/inventory", label: "Inventario" }, { to: "/catalog", label: "Catálogo" },
  { to: "/customers", label: "Clientes" }, { to: "/appointments", label: "Agenda" },
  { to: "/reports", label: "Análisis" }, { to: "/settings", label: "Configuración" },
];

describe("BusinessControlCenter", () => {
  it("groups the allowed destinations into six areas without fetching additional data", async () => {
    const { container } = render(<MemoryRouter><BusinessControlCenter destinations={destinations} snapshot={null} /></MemoryRouter>);
    const control = screen.getByRole("region", { name: "Cada área, a la vista" });
    expect(within(control).getAllByRole("heading", { level: 3 })).toHaveLength(6);
    expect(within(control).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(destinations.map(link => link.to));
    expect((await axe(container, { runOnly: ["link-name", "landmark-unique", "region"] })).violations).toEqual([]);
  });

  it("does not invent zeroes, healthy states or connected channels without an overview", () => {
    render(<MemoryRouter><BusinessControlCenter destinations={destinations} snapshot={null} /></MemoryRouter>);
    expect(screen.getByText("Consulta tus existencias")).toBeVisible();
    expect(screen.getByText("Consulta pendientes y citas")).toBeVisible();
    expect(screen.queryByText(/0 productos|0 órdenes|Sin pendientes|Conectado|Saludable/)).not.toBeInTheDocument();
  });

  it.each([0, 1, 3])("uses verified counts and correct scope with %s low-stock products", lowStockCount => {
    render(<MemoryRouter><BusinessControlCenter destinations={destinations} snapshot={{ orderCount: 7, activeCatalogCount: 12, lowStockCount }} /></MemoryRouter>);
    expect(screen.getByText("7 órdenes completadas")).toBeVisible();
    expect(screen.getByText("Periodo seleccionado")).toBeVisible();
    expect(screen.getByText("Inventario actual")).toBeVisible();
    expect(screen.getByText(lowStockCount === 0 ? "12 productos activos" : lowStockCount === 1 ? "1 producto por reponer" : "3 productos por reponer")).toBeVisible();
    expect(screen.getByText("Consulta pendientes y citas")).toBeVisible();
  });

  it("only exposes destinations passed by the shell and omits areas with no allowed links", () => {
    render(<MemoryRouter><BusinessControlCenter destinations={[{ to: "/orders", label: "Ventas" }]} snapshot={null} /></MemoryRouter>);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    for (const path of ["/pedidos", "/expenses", "/assistant", "/settings/billing", "/inventory"]) {
      expect(document.querySelector(`a[href="${path}"]`)).toBeNull();
    }
  });

  it("does not render a control-center shell without permitted destinations", () => {
    const { container } = render(<MemoryRouter><BusinessControlCenter destinations={[]} snapshot={null} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
