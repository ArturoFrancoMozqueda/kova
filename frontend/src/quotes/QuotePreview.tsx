import { FileText } from "lucide-react";
import { LivePreview } from "@/components/ui/live-preview";
import { TicketLeaderRow, TicketPaper } from "@/components/ui/ticket";

export type QuotePreviewLine = { id: string; name: string; quantity: number; unitPrice: string };

const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
// Same arithmetic as the backend (pricing/calculator.py): catalog prices have
// two decimals, so price × quantity in centavos is exact and never drifts.
const cents = (amount: string) => Math.round(Number(amount) * 100);
const money = (value: number) => formatter.format(value / 100);

/**
 * The proposal the owner is about to share, rendered as a document while it is
 * being prepared. Prices are the catalog's current ones; the server prices the
 * quote again when it is created, and that saved total is the one that counts.
 */
export function QuotePreview({
  businessName,
  customerName,
  expiresAt,
  lines,
  className,
}: {
  businessName: string;
  customerName: string | null;
  expiresAt: string;
  lines: QuotePreviewLine[];
  className?: string;
}) {
  const priced = lines.map(line => ({ ...line, total: cents(line.unitPrice) * line.quantity }));
  const total = priced.reduce((sum, line) => sum + line.total, 0);
  const expires = expiresAt && !Number.isNaN(new Date(expiresAt).getTime())
    ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short" }).format(new Date(expiresAt))
    : null;
  const count = lines.length;
  const summary = `Cotización de ${businessName} para ${customerName ?? "un cliente por elegir"}: ${count} ${count === 1 ? "producto" : "productos"}, total ${money(total)}${expires ? `, vigente hasta el ${expires}` : ""}.`;
  return (
    <LivePreview
      label="Vista previa de la cotización"
      summary={summary}
      className={className}
      frame={{ caption: "Así la recibe tu cliente", icon: <FileText className="h-3.5 w-3.5 text-kova-blue" aria-hidden="true" /> }}
      note={<p>Precios actuales de tu catálogo. Kova guarda el total al crear la cotización; Kova no la envía, la compartes tú.</p>}
    >
      <div className="p-4">
        <TicketPaper className="mx-auto max-w-xs">
          <div className="space-y-3 px-3 py-3 text-[color:var(--ticket-ink)]">
            <div className="text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ticket-muted)]">Cotización</p>
              <p className="mt-1 break-words text-base font-semibold">{businessName}</p>
            </div>
            <div className="border-y border-dashed border-current/20 py-2 text-xs">
              <p><span className="text-[color:var(--ticket-muted)]">Para: </span>{customerName ?? "Elige un cliente"}</p>
              <p className="mt-0.5"><span className="text-[color:var(--ticket-muted)]">Vigente hasta: </span>{expires ?? "Define la vigencia"}</p>
            </div>
            {priced.length ? (
              <ul className="space-y-2">
                {priced.map(line => (
                  <li key={line.id} className="text-xs">
                    <p className="break-words font-medium">{line.name}</p>
                    <TicketLeaderRow label={`${line.quantity} × ${money(cents(line.unitPrice))}`} value={money(line.total)} className="text-xs" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-center text-xs text-[color:var(--ticket-muted)]">Agrega productos para ver la propuesta.</p>
            )}
            <div className="border-t border-dashed border-current/20 pt-2">
              <TicketLeaderRow label="Total" value={money(total)} strong />
            </div>
          </div>
        </TicketPaper>
      </div>
    </LivePreview>
  );
}
