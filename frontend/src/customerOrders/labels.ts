import type {
  CustomerOrderPaymentStatus,
  CustomerOrderStatus,
  FulfillmentType,
  SourceChannel,
} from "./types";

export const statusLabels: Record<CustomerOrderStatus, string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  in_progress: "En preparación",
  ready: "Listo",
  fulfilled: "Entregado",
  cancelled: "Cancelado",
};

export const paymentLabels: Record<CustomerOrderPaymentStatus, string> = {
  unpaid: "Pendiente de cobro",
  paid: "Pagado",
  partially_refunded: "Devolución parcial",
  refunded: "Devuelto",
  voided: "Venta anulada",
};

export const fulfillmentLabels: Record<FulfillmentType, string> = {
  pickup: "Recoger en negocio",
  delivery: "Entrega",
};

export const channelLabels: Record<SourceChannel, string> = {
  counter: "Mostrador",
  phone_whatsapp: "Teléfono / WhatsApp",
  other: "Otro",
};

export const orderedStatuses: CustomerOrderStatus[] = [
  "new",
  "confirmed",
  "in_progress",
  "ready",
  "fulfilled",
];

export function nextStatus(status: CustomerOrderStatus): CustomerOrderStatus | null {
  const index = orderedStatuses.indexOf(status);
  if (index < 0 || index === orderedStatuses.length - 1) return null;
  return orderedStatuses[index + 1];
}

export function previousStatus(status: CustomerOrderStatus): CustomerOrderStatus | null {
  const index = orderedStatuses.indexOf(status);
  if (index <= 0) return null;
  return orderedStatuses[index - 1];
}
