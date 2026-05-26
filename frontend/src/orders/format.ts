const _mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function formatMoney(amount: string | number): string {
  return _mxnFormatter.format(typeof amount === "number" ? amount : Number(amount));
}

export function formatMoneyDelta(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  const formatted = formatMoney(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
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
