import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Testimonials from "./Testimonials";
import type { Testimonial } from "./testimonials.data";

const FIXTURES: readonly Testimonial[] = [
  {
    quote: "Cita de prueba para el layout.",
    name: "Nombre Prueba",
    business: "Negocio Prueba",
    city: "Ciudad Prueba",
  },
  {
    quote: "Segunda cita de prueba.",
    name: "Otra Persona",
    business: "Otro Negocio",
    city: "Otra Ciudad",
  },
];

describe("Testimonials (#clientes)", () => {
  it("renders nothing while there are no real testimonials (production default)", () => {
    // Sin `items`, usa TESTIMONIALS de testimonials.data.ts — vacío hasta que
    // existan citas reales verificadas. La sección no debe existir en el DOM.
    const { container } = render(<Testimonials />);
    expect(container.querySelector("section#clientes")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders one card per testimonial with quote and attribution", () => {
    const { container, getByText } = render(<Testimonials items={FIXTURES} />);
    expect(container.querySelector("section#clientes")).not.toBeNull();
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect(getByText(/Cita de prueba para el layout/)).toBeInTheDocument();
    expect(getByText("Nombre Prueba")).toBeInTheDocument();
    expect(getByText(/Negocio Prueba · Ciudad Prueba/)).toBeInTheDocument();
  });
});
