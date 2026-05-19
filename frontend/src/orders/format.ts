export function formatMoney(amount: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(amount));
}

const reasonLabels: Record<string, string> = {
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  manual_card: "Tarjeta manual",
  customer_return: "Devolución de cliente",
  damaged_item: "Producto dañado",
  wrong_order: "Orden incorrecta",
  other: "Otro",
};

export function reasonLabel(reason: string): string {
  return reasonLabels[reason] ?? reason.replaceAll("_", " ");
}
