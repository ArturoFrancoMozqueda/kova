import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Testimonials from "./Testimonials";
import { TESTIMONIALS, type Testimonial } from "./testimonials.data";

const FIXTURES: readonly Testimonial[] = [
  {
    quote: "Cita de prueba para el layout.",
    name: "Nombre Prueba",
    business: "Negocio Prueba",
    city: "Ciudad Prueba",
  },
  {
    // Atribución mínima: solo negocio (name/city son opcionales).
    quote: "Segunda cita de prueba.",
    business: "Otro Negocio",
  },
];

describe("Testimonials (#clientes)", () => {
  it("renders nothing when there are no testimonials (data gate)", () => {
    const { container } = render(<Testimonials items={[]} />);
    expect(container.querySelector("section#clientes")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders one card per testimonial with quote and attribution", () => {
    const { container, getByText } = render(<Testimonials items={FIXTURES} />);
    expect(container.querySelector("section#clientes")).not.toBeNull();
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect(getByText(/Cita de prueba para el layout/)).toBeInTheDocument();
    // Atribución completa: nombre, negocio y ciudad.
    expect(getByText("Nombre Prueba")).toBeInTheDocument();
    expect(getByText(/, Negocio Prueba · Ciudad Prueba/)).toBeInTheDocument();
    // Atribución mínima: solo el negocio, sin coma ni ciudad colgantes.
    expect(getByText("Otro Negocio")).toBeInTheDocument();
  });

  it("renders the real published testimonials by default", () => {
    const { container } = render(<Testimonials />);
    expect(container.querySelectorAll("blockquote")).toHaveLength(TESTIMONIALS.length);
    for (const item of TESTIMONIALS) {
      expect(container.textContent).toContain(item.quote);
      expect(container.textContent).toContain(item.business);
    }
  });
});
