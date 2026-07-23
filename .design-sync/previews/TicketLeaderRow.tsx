import { TicketLeaderRow, TicketPaper } from "pos-frontend";

export function Rows() {
  return (
    <div className="max-w-xs bg-kova-mist p-6">
      <TicketPaper>
        <div className="space-y-1.5 px-3 py-4">
          <TicketLeaderRow label="Ventas en efectivo" value="$3,240.00" />
          <TicketLeaderRow label="Ventas con tarjeta" value="$2,030.00" />
          <TicketLeaderRow label="Retiros" value="−$500.00" />
          <TicketLeaderRow label="Total del corte" value="$4,770.00" strong />
        </div>
      </TicketPaper>
    </div>
  );
}
