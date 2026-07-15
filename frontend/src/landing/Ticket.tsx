// Ticket térmico — la firma visual de la landing ("el ticket vivo").
// TicketPaper es el primitivo de papel perforado (bordes con radial-gradient,
// sombra drop-shadow que sigue el contorno); ProblemTicket es el mini corte
// del día que responde a los recortes de la sección Problema. Los estilos
// lp-tkt-* viven en landingTheme.tsx.
import type { CSSProperties, ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";
import { SWEET_HOME_CASH_REGISTER, SWEET_HOME_REPORTS } from "@/landing/demo/sweetHome";

const p = copy.landing.problem;

export function TicketPaper({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`lp-tkt ${className}`.trim()} style={style}>
      <div className="lp-tkt-edge" aria-hidden="true" />
      <div className="lp-tkt-body">{children}</div>
      <div className="lp-tkt-edge" data-side="bottom" aria-hidden="true" />
    </div>
  );
}

/** Mini corte de Sweet Home: la respuesta limpia a la pila de recortes. */
export function ProblemTicket() {
  const amounts = [SWEET_HOME_REPORTS.netSales, SWEET_HOME_CASH_REGISTER.expectedCashAfter];
  return (
    <TicketPaper className="lp-problem-ticket" style={{ width: "100%", maxWidth: 320 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span className="lp-tkt-label">{p.ticketTitle}</span>
          <LogoMark size={18} circuitColor="var(--ticket-muted)" coreColor="var(--kova-blue)" />
        </div>
        <hr className="lp-tkt-rule" />
        {p.ticketLines.map((label, i) => (
          <div
            key={label}
            className="tabular"
            style={{ display: "flex", alignItems: "baseline", fontSize: 14, color: "var(--ticket-ink)" }}
          >
            <span>{label}</span>
            <span className="lp-tkt-leader" aria-hidden="true" />
            <span style={{ fontWeight: 600 }}>{formatMoney(amounts[i] ?? 0)}</span>
          </div>
        ))}
        <hr className="lp-tkt-rule" />
        <div
          className="tabular"
          style={{ display: "flex", alignItems: "baseline", color: "var(--ticket-ok)" }}
        >
          <span className="lp-tkt-label" style={{ color: "inherit" }}>{p.ticketTotalLabel}</span>
          <span className="lp-tkt-leader" aria-hidden="true" style={{ borderColor: "rgba(14,138,98,0.4)" }} />
          <span className="lp-tkt-money" style={{ fontSize: 24 }}>{formatMoney(0)}</span>
        </div>
      </div>
    </TicketPaper>
  );
}
