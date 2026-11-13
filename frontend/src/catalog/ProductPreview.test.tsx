import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProductPreview } from "./ProductPreview";

const base = {
  name: "Concha de vainilla", description: "Recién horneada", price: "18.5",
  imageUrl: null, imagePositionX: 50, imagePositionY: 50, imageZoom: 1,
  trackInventory: true, lowStockThreshold: "5", modifierGroupNames: ["Tamaño"],
};

it("renders the draft as the register tile and as the public menu card", () => {
  render(<ProductPreview {...base} />);
  const preview = screen.getByRole("complementary", { name: "Vista previa del producto" });
  expect(preview).toHaveTextContent("Así lo ve tu equipo en Caja");
  expect(preview).toHaveTextContent("Concha de vainilla");
  expect(preview).toHaveTextContent("$18.50");
  expect(preview).toHaveTextContent("cuando queden 5 o menos");
  expect(preview).toHaveTextContent("Al tocarlo, Caja pedirá: Tamaño.");
  // The register shows no photo frame for products without a photo.
  expect(preview.querySelector("img")).toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "En tu menú" }));
  expect(preview).toHaveTextContent("Así lo ven tus clientes");
  expect(preview).toHaveTextContent("Sin fotografía");
  expect(preview).toHaveTextContent(/como se ve en tu menú digital/);
});

it("keeps the decorative render out of the tab order and uses local photos as-is", () => {
  render(<ProductPreview {...base} name="" price="" imageUrl="blob:http://localhost/abc" imageZoom={1.5} />);
  const preview = screen.getByRole("complementary", { name: "Vista previa del producto" });
  expect(preview).toHaveTextContent("Tu producto");
  expect(preview).toHaveTextContent("$0.00");
  expect(preview.querySelector("[inert] button[aria-label=\"Producto en Caja\"]")).not.toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "En tu menú" }));
  const image = preview.querySelector("img");
  expect(image).toHaveAttribute("src", "blob:http://localhost/abc");
  expect(image).toHaveStyle({ transform: "scale(1.5)" });
});
