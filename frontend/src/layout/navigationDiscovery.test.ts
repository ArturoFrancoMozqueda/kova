import { describe, expect, it } from "vitest";
import { discoverSections } from "./navigationDiscovery";

const sections = [
  { to: "/pedidos", label: "Pedidos" },
  { to: "/quotes", label: "Cotizaciones" },
  { to: "/customers", label: "Clientes" },
  { to: "/pedidos/nuevo", label: "Crear pedido" },
  { to: "/catalog", label: "Catálogo" },
  { to: "/catalog?new=product", label: "Crear producto" },
];

describe("task and section discovery ranking", () => {
  it.each([
    ["nuevo cliente", "/customers"],
    ["crear pedido", "/pedidos/nuevo"],
    ["nuevo pedido", "/pedidos/nuevo"],
    ["pedidos", "/pedidos"],
    ["crear producto", "/catalog?new=product"],
    ["cotización", "/quotes"],
    ["CATÁLOGO", "/catalog"],
  ])("prioritizes the named task for '%s'", (query, path) => {
    expect(discoverSections(sections, query)[0]?.to).toBe(path);
  });

  it("keeps discovery restricted to its allowed input and leaves it unchanged", () => {
    const allowed = [{ to: "/pedidos", label: "Pedidos" }];
    expect(discoverSections(allowed, "crear pedido")).toEqual(allowed);
    expect(allowed).toEqual([{ to: "/pedidos", label: "Pedidos" }]);
    expect(discoverSections(allowed, "sucursales")).toEqual([]);
    expect(discoverSections([], "crear producto")).toEqual([]);
  });
  it("takes team intent to the employee tab only when that destination is allowed", () => {
    const settings = { to: "/settings", label: "Configuración" };
    const employees = { to: "/settings/employees", label: "Empleados y accesos" };
    expect(discoverSections([settings, employees], "equipo")[0]).toEqual(employees);
    expect(discoverSections([settings], "equipo")).toEqual([settings]);
  });

  it.each([
    ["agendar cita", "/appointments"], ["reagendar servicio", "/appointments"],
    ["cobrar servicio", "/register"], ["ficha cliente", "/customers"],
  ])("finds the same existing tasks for commerce and services: %s", (query, path) => {
    const destinations = [
      { to: "/appointments", label: "Agenda" }, { to: "/register", label: "Caja" },
      { to: "/customers", label: "Clientes" },
    ];
    expect(discoverSections(destinations, query)[0]?.to).toBe(path);
    expect(discoverSections(destinations.filter(item => item.to !== path), query)).toEqual([]);
  });

  it.each([
    ["tarjeta digital", "/loyalty"], ["recompensas", "/loyalty"],
    ["menú QR", "/settings/public-catalog"], ["identificar socio", "/register"],
  ])("finds the connected loyalty journey for '%s' within permitted destinations", (query, path) => {
    const destinations = [
      { to: "/loyalty", label: "Lealtad" }, { to: "/register", label: "Caja" },
      { to: "/settings/public-catalog", label: "Catálogo público" },
    ];
    expect(discoverSections(destinations, query)[0]?.to).toBe(path);
    expect(discoverSections(destinations.filter(item => item.to !== path), query)).toEqual([]);
  });

});
