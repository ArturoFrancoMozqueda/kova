import { TicketLeaderRow, TicketPaper } from "pos-frontend";

export function Receipt() {
  return (
    <div className="max-w-xs bg-kova-mist p-6">
      <TicketPaper>
        <div className="space-y-1 px-3 py-4">
          <p className="text-center text-sm font-semibold text-[color:var(--ticket-ink)]">
            Panadería La Espiga
          </p>
          <p className="text-center text-xs text-[color:var(--ticket-muted)]">
            Ticket #1042 · 22 jul 2026 · 10:41
          </p>
          <div className="my-3 space-y-1.5">
            <TicketLeaderRow label="2× Concha de vainilla" value="$24.00" />
            <TicketLeaderRow label="1× Café americano" value="$45.00" />
            <TicketLeaderRow label="1× Torta de jamón" value="$65.00" />
          </div>
          <TicketLeaderRow label="Total" value="$134.00" strong />
          <TicketLeaderRow label="Efectivo" value="$150.00" />
          <TicketLeaderRow label="Cambio" value="$16.00" />
          <p className="pt-3 text-center text-xs text-[color:var(--ticket-muted)]">
            ¡Gracias por su compra!
          </p>
        </div>
      </TicketPaper>
    </div>
  );
}
