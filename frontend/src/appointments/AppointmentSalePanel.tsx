import { resolveUserFacingError } from "@/lib/apiError";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/orders/format";
import { formatAppointmentTime } from "./timezone";
import type { Appointment, AppointmentSale } from "./types";

export function AppointmentSalePanel({ appointment, identity, busy, online, onLink }: {
  appointment: Appointment;
  identity: WorkspaceIdentity;
  busy: boolean;
  online: boolean;
  onLink: (saleId: string) => Promise<boolean>;
}) {
  const request = useOperationsRequest(`/api/v1/appointments/${appointment.id}`, identity);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ items: AppointmentSale[]; has_more: boolean } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!open || !online || appointment.sale) return;
    setPage(null);
    setSelected("");
    setError("");
    void request<{ items: AppointmentSale[]; has_more: boolean }>(`/sales?limit=20&offset=${offset}`)
      .then((result) => { if (active) setPage(result); })
      .catch((caught: unknown) => {
        if (active) setError(resolveUserFacingError(caught, "No pudimos consultar las ventas."));
      });
    return () => { active = false; };
  }, [open, online, appointment.sale, request, offset, revision]);
  const sale = appointment.sale;
  return (
    <section aria-label={`Venta de ${appointment.title}`} className="space-y-3 rounded-xl bg-kova-mist/60 p-4">
      <h4 className="font-medium">Venta del servicio</h4>
      {sale ? <>
        <p className="text-sm">{sale.status === "voided" ? "Venta anulada" : "Venta vinculada"} · {formatMoney(sale.total_amount)}</p>
        {Number(sale.refunded_amount) > 0 && <p className="text-sm">Devoluciones registradas: {formatMoney(sale.refunded_amount)}</p>}
        <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline" to={`/orders/${sale.id}`}>Ver venta y comprobante</Link>
      </> : <>
        <p className="text-sm text-kova-muted">Sin venta vinculada. Registrar la atención no registra un cobro.</p>
        {["scheduled", "completed"].includes(appointment.status) && <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} to={`/register?customerId=${appointment.customer_id}&appointmentId=${appointment.id}`}>Cobrar al cliente</Link>
          <Button size="sm" variant="outline" disabled={!online || busy} onClick={() => setOpen(!open)}>{open ? "Cerrar selección de venta" : "Vincular venta existente"}</Button>
        </div>}
        {open && <div className="space-y-3">
          <p className="text-xs text-kova-muted">Elige la venta de este servicio. Sólo se muestran ventas vigentes del mismo cliente y sucursal, sin otra cita vinculada. El vínculo se conserva en el historial.</p>
          {error ? <div><p role="alert">{error}</p><Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Reintentar ventas</Button></div> : !page ? <p role="status">Consultando ventas…</p> : <>
            {page.items.length === 0 ? <p className="text-sm">No hay ventas disponibles en esta página. Puedes cobrar al cliente en Caja y después vincular su venta.</p> : <label className="block text-sm">Venta que corresponde a la cita
              <select className="mt-1 min-h-11 w-full rounded-lg border border-input bg-white p-3" value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value="">Selecciona una venta</option>
                {page.items.map((item) => <option key={item.id} value={item.id}>{formatAppointmentTime(item.created_at, appointment.timezone)} · {formatMoney(item.total_amount)}{Number(item.refunded_amount) > 0 ? ` · Devoluciones ${formatMoney(item.refunded_amount)}` : ""}</option>)}
              </select>
            </label>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!selected || busy || !online} onClick={() => void onLink(selected).then((ok) => { if (ok) setOpen(false); })}>Confirmar vínculo de venta</Button>
              <Button variant="ghost" disabled={offset === 0 || busy} onClick={() => setOffset((value) => Math.max(0, value - 20))}>Ventas anteriores de la lista</Button>
              <Button variant="ghost" disabled={!page.has_more || busy} onClick={() => setOffset((value) => value + 20)}>Más ventas del cliente</Button>
            </div>
          </>}
        </div>}
      </>}
    </section>
  );
}
