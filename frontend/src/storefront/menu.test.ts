import { expect, it } from "vitest";
import { browseMenu, menuRequestMessage, menuSubtotal, type MenuProduct } from "./menu";

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
  expect(message).toContain("El negocio confirmará disponibilidad, pago y entrega.");
  expect(message).toContain("Notas: Recoger a las 2");
});

const products: MenuProduct[] = [
  { id: "bread", name: "Pan de nuez", description: "Con canela", price_amount: "45.00", availability: "available" },
  { id: "coffee", name: "Café de olla", description: "Con piloncillo y canela", price_amount: "35.50", availability: "unavailable" },
  { id: "toast", name: "Tostada de aguacate", description: null, price_amount: "95.00", availability: "available" },
];

it("finds all query words across name and description regardless of order or accents", () => {
  expect(browseMenu(products, { query: " CANELA   CAFE ", onlyAvailable: false, sort: "published" }).map(product => product.id)).toEqual(["coffee"]);
  expect(browseMenu(products, { query: "cafe inexistente", onlyAvailable: false, sort: "published" })).toEqual([]);
  expect(browseMenu(products, { query: "canela cafe", onlyAvailable: true, sort: "published" })).toEqual([]);
});

it("sorts only the visible results without changing publication or basket order", () => {
  const originalOrder = products.map(product => product.id);
  expect(browseMenu(products, { query: "", onlyAvailable: false, sort: "price_asc" }).map(product => product.id)).toEqual(["coffee", "bread", "toast"]);
  expect(browseMenu(products, { query: "", onlyAvailable: false, sort: "price_desc" }).map(product => product.id)).toEqual(["toast", "bread", "coffee"]);
  expect(browseMenu(products, { query: "", onlyAvailable: false, sort: "name" }).map(product => product.id)).toEqual(["coffee", "bread", "toast"]);
  expect(browseMenu(products, { query: "canela", onlyAvailable: true, sort: "price_asc" }).map(product => product.id)).toEqual(["bread"]);
  expect(browseMenu(products, { query: "   ", onlyAvailable: false, sort: "published" }).map(product => product.id)).toEqual(originalOrder);
  expect(products.map(product => product.id)).toEqual(originalOrder);
});
