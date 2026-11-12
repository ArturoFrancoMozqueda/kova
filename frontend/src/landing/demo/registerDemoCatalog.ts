// Catálogo de la demo local de Caja de Sweet Home. El recorrido del producto y
// las mini-interfaces de la landing toman de aquí los mismos productos y la
// misma venta de $186 (Cold brew + Capuchino mediano + Yogurt con granola).
export type ShowcaseCategory = "hot" | "cold" | "bakery" | "food";

export type ShowcaseProduct = {
  id: string;
  name: string;
  price: number;
  category: ShowcaseCategory;
  image?: string;
};

export const REGISTER_DEMO_PRODUCTS: readonly ShowcaseProduct[] = [
  { id: "agua", name: "Agua mineral", price: 32, category: "cold", image: "/showcase/products/agua-mineral.png" },
  { id: "alfajores", name: "Alfajores", price: 32, category: "bakery", image: "/showcase/products/alfajores.png" },
  { id: "capuchino", name: "Capuchino mediano", price: 56, category: "hot", image: "/showcase/products/capuchino-mediano.png" },
  { id: "chocolate", name: "Chocolate frío", price: 55, category: "cold", image: "/showcase/products/chocolate-frio.png" },
  { id: "cold-brew", name: "Cold brew", price: 62, category: "cold", image: "/showcase/products/cold-brew.png" },
  { id: "concha", name: "Concha vainilla", price: 24, category: "bakery", image: "/showcase/products/concha-vainilla.png" },
  { id: "croissant", name: "Croissant mantequilla", price: 42, category: "bakery", image: "/showcase/products/croissant-mantequilla.png" },
  { id: "yogurt", name: "Yogurt con granola", price: 68, category: "food" },
];

export const REGISTER_DEMO_CART: Readonly<Record<string, number>> = { "cold-brew": 1, capuchino: 1, yogurt: 1 };

export function demoProduct(id: string): ShowcaseProduct {
  const product = REGISTER_DEMO_PRODUCTS.find((candidate) => candidate.id === id);
  if (!product) throw new Error(`Producto demo desconocido: ${id}`);
  return product;
}

export const REGISTER_DEMO_TOTAL = Object.entries(REGISTER_DEMO_CART).reduce(
  (sum, [id, qty]) => sum + demoProduct(id).price * qty,
  0,
);

// Efecto de la venta en el resto del negocio (mismo turno, mismo día).
export const TOUR_INVENTORY = [
  { id: "cold-brew", before: 18, after: 17, threshold: 6 },
  { id: "yogurt", before: 6, after: 5, threshold: 5 },
  { id: "croissant", before: 14, after: 14, threshold: 6 },
  { id: "concha", before: 22, after: 22, threshold: 8 },
] as const;

export const TOUR_SHIFT = {
  employee: "Sofía",
  openedAt: "8:00 AM",
  openingCash: 500,
  cashSalesBefore: 1554,
  outflows: 200,
  saleTime: "5:42 PM",
  movements: [
    { label: "Compra de leche", time: "1:15 PM", amount: -200 },
    { label: "Venta · Efectivo", time: "12:30 PM", amount: 124 },
  ],
} as const;
