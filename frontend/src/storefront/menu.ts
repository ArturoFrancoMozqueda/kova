import type { ProductPhotoData } from "./ProductPhoto";

export type MenuProduct = ProductPhotoData & {
  id: string;
  description: string | null;
  price_amount: string;
  availability: "available" | "unavailable";
};
export type MenuLine = { product: MenuProduct; quantity: number };
export type OrderOrigin = "remote" | "onsite";
export const MAX_MENU_PRODUCTS = 20;
export const MAX_MENU_QUANTITY = 99;
export const MAX_REQUEST_MESSAGE = 1000;

const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
// Work in centavos so a basket of decimal prices does not accumulate rounding errors.
export const priceInCents = (amount: string) => Math.round(Number(amount) * 100);
export const menuMoney = (cents: number) => formatter.format(cents / 100);
export const menuSubtotal = (lines: MenuLine[]) => lines.reduce(
  (total, { product, quantity }) => total + priceInCents(product.price_amount) * quantity, 0,
);
export const searchMenu = (value: string) => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").trim();

export type MenuSort = "published" | "price_asc" | "price_desc" | "name";
const nameOrder = new Intl.Collator("es-MX", { sensitivity: "base", numeric: true });

/** Search only the published product fields; preserve the business's order by default. */
export function browseMenu(products: readonly MenuProduct[], {
  query, onlyAvailable, sort,
}: { query: string; onlyAvailable: boolean; sort: MenuSort }) {
  const terms = searchMenu(query).split(/\s+/).filter(Boolean);
  const visible = products.filter(product => {
    if (onlyAvailable && product.availability !== "available") return false;
    const text = searchMenu(`${product.name} ${product.description ?? ""}`);
    return terms.every(term => text.includes(term));
  });
  if (sort === "name") visible.sort((a, b) => nameOrder.compare(a.name, b.name));
  if (sort === "price_asc") visible.sort((a, b) => priceInCents(a.price_amount) - priceInCents(b.price_amount));
  if (sort === "price_desc") visible.sort((a, b) => priceInCents(b.price_amount) - priceInCents(a.price_amount));
  return visible;
}

/** Human-readable intake for the existing request inbox; never an authoritative order or price. */
export function menuRequestMessage(lines: MenuLine[], origin: OrderOrigin, note: string) {
  return [
    "Solicitud de pedido · Menú digital",
    `Origen: ${origin === "onsite" ? "En el negocio" : "A distancia"}`,
    ...lines.map(({ product, quantity }) => `${quantity} × ${product.name}`),
    `Subtotal estimado: ${menuMoney(menuSubtotal(lines))} MXN`,
    "Pendiente de aceptación del negocio. Sin reserva ni pago.",
    ...(note.trim() ? [`Notas: ${note.trim()}`] : []),
  ].join("\n");
}
