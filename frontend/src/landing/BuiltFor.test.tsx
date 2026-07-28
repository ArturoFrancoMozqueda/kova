import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { copy } from "@/i18n/messages";
import BuiltFor from "./BuiltFor";

describe("BuiltFor (#comercios)", () => {
  it("renders a real section for the navbar '¿Es para mí?' link", () => {
    const { container } = render(<BuiltFor />);
    const section = container.querySelector("section#comercios");
    expect(section).not.toBeNull();
  });

  it("lists every business type with its honesty tag", () => {
    const { getByText, getAllByText } = render(<BuiltFor />);
    for (const type of copy.landing.builtFor.types) {
      expect(getByText(type.name)).toBeInTheDocument();
    }
    // Las tres etiquetas de honestidad aparecen (dos giros por etiqueta).
    expect(getAllByText("Recomendado")).toHaveLength(2);
    expect(getAllByText("Compatible")).toHaveLength(2);
    expect(getAllByText("Caso por caso")).toHaveLength(2);
  });
});
