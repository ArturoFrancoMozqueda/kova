import type { TableStatus } from "@/appointments/bookingTypes";
export const tableStatusText: Record<TableStatus, string> = {
  requested: "Pendiente de confirmación",
  confirmed: "Reserva confirmada",
  seated: "Mesa ocupada",
  completed: "Visita terminada",
  declined: "No confirmada",
  cancelled: "Cancelada",
  no_show: "No se presentó",
};
