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

const _dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const _dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return _dateFormatter.format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return _dateTimeFormatter.format(date);
}
