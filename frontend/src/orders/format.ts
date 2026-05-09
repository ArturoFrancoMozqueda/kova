export function formatMoney(amount: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "MXN",
  }).format(Number(amount));
}

export function reasonLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}
