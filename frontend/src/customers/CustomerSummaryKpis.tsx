import { useEffect, useState } from "react";
import { CalendarClock, Receipt, ShoppingBag, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/visual";
import { resolveUserFacingError } from "@/lib/apiError";
import { customerSummary, type CustomerSummary } from "./api";

const money = (amount: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(amount));

/** Purchase KPIs for one customer, computed by the server for the active branch. */
export function CustomerSummaryKpis({ customerId }: { customerId: string }) {
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // Never show the previous customer's figures while the next one loads.
    setSummary(null);
    setError("");
    void customerSummary(customerId, { signal: controller.signal })
      .then((result) => { if (active && result.customer_id === customerId) setSummary(result); })
      .catch((reason: unknown) => {
        if (active) setError(resolveUserFacingError(reason, "No pudimos cargar el resumen de compras."));
      });
    return () => { active = false; controller.abort(); };
  }, [customerId, revision]);

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-destructive-strong">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Reintentar resumen</Button>
      </div>
    );
  }
  if (!summary) {
    return (
      <div aria-busy="true" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <p role="status" className="sr-only">Cargando resumen de compras…</p>
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-kova-xl" />)}
      </div>
    );
  }
  const last = summary.last_purchase_at
    ? new Date(summary.last_purchase_at).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
    : "Sin compras";
  return (
    <section aria-label="Resumen de compras en esta sucursal" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Compras" value={summary.purchase_count} icon={<ShoppingBag />} />
        <KpiCard label="Gasto neto" value={money(summary.net_spent_amount)} icon={<Wallet />} emphasis />
        <KpiCard label="Ticket promedio" value={summary.average_ticket_amount ? money(summary.average_ticket_amount) : "—"} icon={<Receipt />} />
        <KpiCard label="Última compra" value={<span className="text-base sm:text-lg">{last}</span>} icon={<CalendarClock />} />
      </div>
      <p className="text-xs text-muted-foreground">Ventas completadas en esta sucursal, ya descontadas sus devoluciones.</p>
    </section>
  );
}
