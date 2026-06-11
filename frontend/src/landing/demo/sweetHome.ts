// Sweet Home — datos demo de la landing pública.
// Única fuente de verdad del negocio ficticio que recorre toda la landing
// (brief: docs/claude/landing-visual-brief.md, sección 3). La venta de $186
// debe ser rastreable en POS → Inventario → Caja → Reportes.
// Estos datos NUNCA se importan fuera de frontend/src/landing/.
import { copy } from "@/i18n/messages";

const t = copy.landing.sweetHome;

export type SweetHomeCategoryId = "bebidas" | "reposteria";

export type SweetHomeIconId =
  | "latte-vainilla"
  | "americano"
  | "chocolate"
  | "cheesecake"
  | "brownie"
  | "galleta"
  | "concha"
  | "panque";

export type SweetHomeProduct = {
  id: string;
  name: string;
  price: number;
  categoryId: SweetHomeCategoryId;
  iconId: SweetHomeIconId;
};

export const SWEET_HOME_BUSINESS = {
  name: t.shopName,
  tagline: t.tagline,
} as const;

export const SWEET_HOME_PRODUCTS: readonly SweetHomeProduct[] = [
  { id: "latte-vainilla", name: t.products.latteVainilla, price: 58, categoryId: "bebidas", iconId: "latte-vainilla" },
  { id: "americano", name: t.products.americano, price: 42, categoryId: "bebidas", iconId: "americano" },
  { id: "chocolate", name: t.products.chocolate, price: 55, categoryId: "bebidas", iconId: "chocolate" },
  { id: "cheesecake", name: t.products.cheesecake, price: 72, categoryId: "reposteria", iconId: "cheesecake" },
  { id: "brownie", name: t.products.brownie, price: 38, categoryId: "reposteria", iconId: "brownie" },
  { id: "galleta-avena", name: t.products.galletaAvena, price: 28, categoryId: "reposteria", iconId: "galleta" },
  { id: "concha", name: t.products.concha, price: 32, categoryId: "reposteria", iconId: "concha" },
  { id: "panque", name: t.products.panque, price: 45, categoryId: "reposteria", iconId: "panque" },
] as const;

export type SweetHomeSaleLine = { productId: string; qty: number };

/** La venta que lo mueve todo: $186 en efectivo, atendida por Sofía. */
export const SWEET_HOME_ACTIVE_SALE = {
  lines: [
    { productId: "latte-vainilla", qty: 1 },
    { productId: "cheesecake", qty: 1 },
    { productId: "galleta-avena", qty: 2 },
  ] as readonly SweetHomeSaleLine[],
  paymentMethod: "cash",
  attendedBy: t.employee,
  timeLabel: "5:42 PM",
} as const;

export function sweetHomeSaleTotal(
  lines: readonly SweetHomeSaleLine[] = SWEET_HOME_ACTIVE_SALE.lines,
): number {
  return lines.reduce((sum, line) => {
    const product = SWEET_HOME_PRODUCTS.find((p) => p.id === line.productId);
    return sum + (product ? product.price * line.qty : 0);
  }, 0);
}

export const SWEET_HOME_SALE_TOTAL = sweetHomeSaleTotal();

// Solo repostería lleva seguimiento de stock (el inventario real muestra
// "Productos con seguimiento"; las bebidas no aparecen en el preview).
export const SWEET_HOME_INVENTORY = {
  lowStockCount: 1,
  items: [
    { productId: "cheesecake", stockBefore: 6, sold: 1, stockAfter: 5, threshold: 5, low: true },
    { productId: "galleta-avena", stockBefore: 24, sold: 2, stockAfter: 22, threshold: 8, low: false },
    { productId: "brownie", stockBefore: 14, sold: 0, stockAfter: 14, threshold: 6, low: false },
    { productId: "concha", stockBefore: 10, sold: 0, stockAfter: 10, threshold: 6, low: false },
  ],
  alertProductId: "cheesecake",
} as const;

export const SWEET_HOME_CASH_REGISTER = {
  employee: t.employee,
  openedAtLabel: "8:00 AM",
  openingCash: 500,
  cashSalesBefore: 1554,
  cashSalesAfter: 1740,
  outflows: 200,
  expectedCashBefore: 1854,
  expectedCashAfter: 2040,
  newMovementAmount: 186,
  newMovementTimeLabel: "5:42 PM",
} as const;

export const SWEET_HOME_REPORTS = {
  netSales: 4820,
  cashTotal: 1740,
  cardTotal: 3080,
  cashSharePct: 36,
  cardSharePct: 64,
  orders: 37,
  avgTicket: 130,
  deltaVsYesterdayPct: 18,
  bestHoursLabel: "5:00 PM – 7:00 PM",
  topProductId: "latte-vainilla",
} as const;

export const SWEET_HOME_EMPLOYEES = [
  { name: t.employee, role: "cashier", active: true },
  { name: t.owner, role: "owner", active: false },
] as const;
