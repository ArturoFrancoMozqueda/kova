import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DonutChart, InitialsAvatar, KpiCard, Meter, RankBars, StackedBar, StepStrip } from "./index";
import { EmptyIllustration } from "./illustrations";

it("describes each visual in text for assistive technology", () => {
  render(<>
    <Meter label="Concha" value={3} max={10} marker={5} markerLabel="mínimo 5" valueLabel="3 disponibles" />
    <RankBars label="Más vendidos" emptyLabel="Sin ventas" rows={[{ id: "a", label: "Concha", value: 30, valueLabel: "$30.00" }]} />
    <DonutChart label="Cobros" centerLabel="Total" centerValue="$100.00" emptyLabel="Sin cobros" slices={[
      { id: "cash", label: "Efectivo", value: 75, valueLabel: "$75.00" }, { id: "card", label: "Tarjeta manual", value: 25, valueLabel: "$25.00" }]} />
    <StackedBar label="Existencia" segments={[{ id: "a", label: "Disponible", value: 4, tone: "growth" }, { id: "r", label: "Apartado", value: 2, tone: "warning" }]} />
    <StepStrip label="Progreso" current={1} steps={[{ id: "n", label: "Nuevo" }, { id: "p", label: "En preparación" }, { id: "l", label: "Listo" }]} />
  </>);
  expect(screen.getByRole("meter", { name: "Concha: 3 disponibles · mínimo 5" })).toHaveAttribute("aria-valuemax", "10");
  expect(screen.getByRole("list", { name: "Más vendidos" })).toHaveTextContent("Concha$30.00");
  expect(screen.getByRole("img", { name: "Cobros: Efectivo 75%, Tarjeta manual 25%" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Existencia: Disponible 4, Apartado 2" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Progreso" })).toHaveTextContent("Nuevo (completado)En preparación (actual)Listo");
});

it("shows honest empty states instead of empty charts", () => {
  render(<>
    <RankBars label="x" emptyLabel="Sin ventas en este periodo" rows={[]} />
    <DonutChart label="x" centerLabel="" centerValue="" emptyLabel="Sin cobros registrados" slices={[{ id: "a", label: "A", value: 0, valueLabel: "$0" }]} />
  </>);
  expect(screen.getByText("Sin ventas en este periodo")).toBeInTheDocument();
  expect(screen.getByText("Sin cobros registrados")).toBeInTheDocument();
});

it("keeps avatars, KPI icons and illustrations decorative", () => {
  const { container } = render(<>
    <InitialsAvatar name="María López" />
    <InitialsAvatar name="caja@panaderia.mx" />
    <KpiCard label="Ventas" value="$100.00" icon={<svg />} />
    <EmptyIllustration name="box" />
  </>);
  const avatars = container.querySelectorAll("span[aria-hidden='true']");
  expect(avatars[0]).toHaveTextContent("ML");
  expect(avatars[1]).toHaveTextContent("CA");
  expect(container.querySelector("svg[viewBox='0 0 120 96']")).toHaveAttribute("aria-hidden", "true");
});
