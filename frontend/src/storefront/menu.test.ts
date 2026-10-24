import { expect, it } from "vitest";
import { menuRequestMessage, menuSubtotal } from "./menu";

it("adds decimal prices in centavos before multiplying quantities", () => {
  const product = { id: "p", name: "Producto", description: null, availability: "available" as const };
  expect(menuSubtotal([
    { product: { ...product, price_amount: "0.10" }, quantity: 3 },
    { product: { ...product, price_amount: "0.20" }, quantity: 1 },
    { product: { ...product, price_amount: "19.99" }, quantity: 3 },
  ])).toBe(6047);
});

it("keeps every selected quantity and identifies remote intake as pending acceptance", () => {
  const message = menuRequestMessage([{ product: { id: "p", name: "Café frío", description: null,
    price_amount: "45.50", availability: "available" }, quantity: 2 }], "remote", "  Recoger a las 2  ");
  expect(message).toContain("Origen: A distancia\n2 × Café frío");
  expect(message).toContain("Subtotal estimado: $91.00 MXN");
  expect(message).toContain("Pendiente de aceptación del negocio. Sin reserva ni pago.");
  expect(message).toContain("Notas: Recoger a las 2");
});
