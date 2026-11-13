import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { QuotePreview } from "./QuotePreview";

it("renders the proposal with exact line totals in centavos", () => {
  render(<QuotePreview businessName="Panadería Lupita" customerName="María López" expiresAt="2026-12-01T18:00" lines={[
    { id: "a", name: "Concha", quantity: 3, unitPrice: "18.35" },
    { id: "b", name: "Pastel 3 leches", quantity: 1, unitPrice: "420.10" },
  ]} />);
  const preview = screen.getByRole("complementary", { name: "Vista previa de la cotización" });
  expect(preview).toHaveTextContent("Panadería Lupita");
  expect(preview).toHaveTextContent("Para: María López");
  expect(preview).toHaveTextContent("3 × $18.35");
  expect(preview).toHaveTextContent("$55.05");
  expect(preview).toHaveTextContent("$475.15");
  expect(preview).toHaveTextContent("1 de diciembre de 2026");
  expect(preview).toHaveTextContent("Kova no la envía, la compartes tú.");
});

it("guides the owner while the draft is empty", () => {
  render(<QuotePreview businessName="Panadería Lupita" customerName={null} expiresAt="" lines={[]} />);
  const preview = screen.getByRole("complementary", { name: "Vista previa de la cotización" });
  expect(preview).toHaveTextContent("Elige un cliente");
  expect(preview).toHaveTextContent("Define la vigencia");
  expect(preview).toHaveTextContent("Agrega productos para ver la propuesta.");
  expect(preview).toHaveTextContent("$0.00");
});
