import type { CustomerOrderStatus } from "@/customerOrders/types";
import type { PrepCard, PrepStatus } from "./api";

export const FLOW: PrepStatus[] = ["received", "preparing", "ready", "delivered"];

export const statusLabels: Record<PrepStatus, string> = {
  received: "Recibido",
  preparing: "En preparación",
  ready: "Listo",
  delivered: "Entregado",
};

export const nextLabels: Partial<Record<PrepStatus, string>> = {
  received: "Empezar",
  preparing: "Marcar listo",
  ready: "Entregar",
};

export const next = (status: PrepStatus): PrepStatus | null => FLOW[FLOW.indexOf(status) + 1] ?? null;
export const previous = (status: PrepStatus): PrepStatus | null => FLOW[FLOW.indexOf(status) - 1] ?? null;

/** A pedido moves through Pedidos: the queue maps its steps to the order's own status. */
export const orderStatusFor: Record<PrepStatus, CustomerOrderStatus> = {
  received: "confirmed",
  preparing: "in_progress",
  ready: "ready",
  delivered: "fulfilled",
};

/** A pedido can only be handed over once its sale is paid. */
export const needsPayment = (card: PrepCard) =>
  card.kind === "customer_order" && card.status === "ready" && card.payment_status !== "paid";

/** Minutes since the work arrived, until it is ready. */
export function waitingMinutes(card: PrepCard, now: number): number {
  const end = card.ready_at ? Date.parse(card.ready_at) : now;
  return Math.max(0, Math.floor((end - Date.parse(card.received_at)) / 60_000));
}

export function isLate(card: PrepCard, alertMinutes: number, now: number): boolean {
  return (card.status === "received" || card.status === "preparing") && waitingMinutes(card, now) >= alertMinutes;
}

export function cardTitle(card: PrepCard): string {
  return card.kind === "sale" ? `#${card.number}` : card.folio ?? "Pedido";
}
