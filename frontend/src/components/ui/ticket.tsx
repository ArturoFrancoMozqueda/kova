// Primitivo de "ticket térmico" para la app (paralelo al de la landing en
// landing/Ticket.tsx — no lo reemplaza, no lo importa). Envuelve un recibo o
// corte con papel + bordes perforados en pantalla; el hijo (ReceiptTemplate /
// CorteTemplate) sigue siendo el propio print-receipt-root/print-corte-root
// y se imprime exactamente igual — el papel se neutraliza en @media print
// (ver styles.css). Clases .tkt-* definidas ahí.
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TicketPaper({
  children,
  className,
  ...containerProps
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...containerProps} className={cn("tkt-paper", className)}>
      <div className="tkt-edge" aria-hidden="true" />
      <div className="tkt-body rounded-b-[2px] px-1 pb-1 pt-0.5">{children}</div>
      <div className="tkt-edge" data-side="bottom" aria-hidden="true" />
    </div>
  );
}

/** Línea con "puntos guía" entre una etiqueta y un valor, estilo recibo. */
export function TicketLeaderRow({
  label,
  value,
  className,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline text-sm",
        strong ? "font-semibold text-[color:var(--ticket-ink)]" : "text-[color:var(--ticket-muted)]",
        className,
      )}
    >
      <span>{label}</span>
      <span className="tkt-leader print:hidden" aria-hidden="true" />
      <span className={cn("tkt-money", strong && "text-base")}>{value}</span>
    </div>
  );
}
