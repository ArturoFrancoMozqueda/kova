import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BusinessNextActions } from "./BusinessNextActions";

const destinations = ["/settings/public-catalog", "/commercial-requests", "/crm", "/quotes", "/catalog", "/inventory", "/purchasing", "/replenishment", "/register", "/pedidos", "/customers", "/service-cases", "/reports", "/operations-queue"].map(to => ({ to }));
function Location() { return <output aria-label="Destino actual">{useLocation().pathname}</output>; }
function host(pathname: string, allowed = destinations) {
  return render(<MemoryRouter initialEntries={[pathname]}>
    <BusinessNextActions pathname={pathname} destinations={allowed} /><Location />
  </MemoryRouter>);
}

describe("next actions within existing business sections", () => {
  it.each([
    ["/catalog", ["Revisar existencias", "Preparar compra"]],
    ["/settings/public-catalog", ["Atender solicitudes", "Editar productos y fotos"]],
    ["/inventory", ["Planear reposición", "Preparar compra"]],
    ["/replenishment", ["Preparar compra", "Revisar existencias"]],
    ["/purchasing", ["Revisar existencias", "Cobrar una venta"]],
    ["/commercial-requests", ["Continuar seguimiento comercial", "Gestionar clientes"]],
    ["/crm", ["Revisar cotizaciones", "Gestionar clientes"]],
    ["/quotes", ["Revisar pedidos", "Gestionar clientes"]],
    ["/orders", ["Atender incidencias", "Revisar resultados"]],
    ["/inbox", ["Atender pendientes", "Gestionar clientes"]],
    ["/customers", ["Atender pendientes"]],
    ["/reports", ["Atender pendientes"]],
  ])("offers at most two relevant actions on %s", (path, labels) => {
    host(path as string);
    const nav = screen.getByRole("navigation", { name: "Continúa tu operación" });
    expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(labels);
    for (const link of within(nav).getAllByRole("link")) expect(link).toHaveClass("min-h-11");
  });

  it.each(["/dashboard", "/register", "/shifts", "/caja", "/turnos", "/operations-queue", "/pedidos/nuevo", "/pedidos/123", "/orders/123/refund", "/catalog/edit", "/settings"])("never interrupts an open task or duplicates the daily overview on %s", path => {
    host(path);
    expect(screen.queryByRole("navigation", { name: "Continúa tu operación" })).toBeNull();
  });

  it("uses the allowed destinations, hides empty navigation, and follows a real route", () => {
    const view = host("/inventory", [{ to: "/purchasing" }]);
    const link = screen.getByRole("link", { name: "Preparar compra" });
    expect(screen.queryByRole("link", { name: "Revisar existencias" })).toBeNull();
    expect(link).toHaveAttribute("href", "/purchasing");
    link.focus(); expect(link).toHaveFocus();
    fireEvent.click(link);
    expect(screen.getByLabelText("Destino actual")).toHaveTextContent("/purchasing");
    view.unmount(); host("/inventory", []);
    expect(screen.queryByRole("navigation", { name: "Continúa tu operación" })).toBeNull();
  });

  it("takes the owner from publication to requests without changing publication", () => {
    host("/settings/public-catalog");
    const link = screen.getByRole("link", { name: "Atender solicitudes" });
    expect(link).toHaveAttribute("href", "/commercial-requests");
    fireEvent.click(link);
    expect(screen.getByLabelText("Destino actual")).toHaveTextContent("/commercial-requests");
  });

  it("never substitutes a sharing or stock task with an unavailable destination", () => {
    const view = host("/settings/public-catalog", [{ to: "/catalog" }]);
    expect(screen.queryByRole("link", { name: "Atender solicitudes" })).toBeNull();
    expect(screen.getByRole("link", { name: "Editar productos y fotos" })).toHaveAttribute("href", "/catalog");
    view.unmount(); host("/settings/public-catalog", [{ to: "/purchasing" }]);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("keeps the order history as the next step even with create permission, preserving record conversions", () => {
    const view = render(<MemoryRouter><BusinessNextActions pathname="/quotes" destinations={[{ to: "/pedidos" }]} canCreateCustomerOrders /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Crear pedido" })).toBeNull();
    expect(screen.getByRole("link", { name: "Revisar pedidos" })).toHaveAttribute("href", "/pedidos");
    view.rerender(<MemoryRouter><BusinessNextActions pathname="/quotes" destinations={[{ to: "/pedidos" }]} canCreateCustomerOrders={false} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Crear pedido" })).toBeNull();
    expect(screen.getByRole("link", { name: "Revisar pedidos" })).toHaveAttribute("href", "/pedidos");
    view.rerender(<MemoryRouter><BusinessNextActions pathname="/quotes" destinations={[]} canCreateCustomerOrders /></MemoryRouter>);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("does not substitute a missing commercial stage with a disconnected order", () => {
    host("/commercial-requests", [{ to: "/pedidos" }, { to: "/customers" }]);
    expect(screen.queryByRole("link", { name: "Revisar pedidos" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Crear pedido" })).toBeNull();
    expect(screen.getByRole("link", { name: "Gestionar clientes" })).toBeVisible();
  });

});
