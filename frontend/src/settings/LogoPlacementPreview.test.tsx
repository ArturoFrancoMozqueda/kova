import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LogoPlacementPreview } from "./LogoPlacementPreview";

const saved = "/api/v1/settings/receipt/logo/abc.webp";

it("shows the saved logo on the header, the receipt and the loyalty card", () => {
  render(<LogoPlacementPreview src={saved} businessName="Panadería Lupita" saved />);
  const preview = screen.getByRole("complementary", { name: "Dónde aparece tu logo" });
  expect(preview).toHaveTextContent("Encabezado de Kova");
  expect(preview).toHaveTextContent("Recibo impreso");
  expect(preview).toHaveTextContent("Tarjeta de lealtad");
  expect(preview).toHaveTextContent("Usar el logo del negocio");
  expect(Array.from(preview.querySelectorAll("img")).map(img => img.getAttribute("src"))).toEqual([saved, saved, saved]);
});

it("previews an unsaved crop without promising the loyalty card", () => {
  render(<LogoPlacementPreview src="blob:local" imageStyle={{ transform: "scale(1.4)" }} businessName="" saved={false} unsavedTitle="Vista en Kova" />);
  const preview = screen.getByRole("complementary", { name: "Dónde aparece tu logo" });
  expect(preview).toHaveTextContent("Vista en Kova");
  expect(preview).toHaveTextContent("Tu negocio");
  expect(preview).not.toHaveTextContent("Tarjeta de lealtad");
  expect(preview.querySelector("img")).toHaveStyle({ transform: "scale(1.4)" });
});
