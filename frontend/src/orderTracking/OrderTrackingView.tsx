import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, Check, CheckCircle2, ChevronDown, CircleCheck, Clock3, PackageCheck, RefreshCw, ShoppingBag, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatMoney } from "@/orders/format";

export type TrackingStatus = "pending_review" | "accepted" | "confirmed" | "in_progress" | "ready" | "fulfilled" | "cancelled" | "dismissed";
export type OrderTracking = {
  business_name: string; branch_name: string; status: TrackingStatus; folio: string | null;
  total_amount: string | null; items: { product_name: string; quantity: number }[];
  catalog_path: string | null; updated_at: string; expires_at: string;
};
const statusCopy = {
  pending_review: { title: "Solicitud recibida", detail: "Tu selección ya llegó al negocio. El equipo revisará la disponibilidad. Aquí verás si acepta tu pedido.", icon: Clock3 },
  accepted: { title: "Pedido registrado", detail: "El equipo está revisando los últimos detalles. Aquí verás cuando confirme tu pedido.", icon: ShoppingBag },
  confirmed: { title: "Pedido confirmado", detail: "El negocio confirmó tu pedido y puede continuar con su preparación.", icon: CircleCheck },
  in_progress: { title: "En preparación", detail: "El equipo está preparando tu pedido. Aquí verás cuando lo marque como listo.", icon: ShoppingBag },
  ready: { title: "Tu pedido está listo", detail: "El negocio marcó tu pedido como listo. Coordina con el equipo su entrega.", icon: PackageCheck },
  fulfilled: { title: "Pedido entregado", detail: "El negocio registró la entrega de este pedido. Gracias por tu compra.", icon: CheckCircle2 },
  cancelled: { title: "Pedido cancelado", detail: "El negocio canceló este pedido. Consulta al equipo si necesitas una aclaración.", icon: XCircle },
  dismissed: { title: "Solicitud no aceptada", detail: "El negocio descartó esta solicitud. Puedes volver al menú para preparar otra.", icon: XCircle },
};
const steps = ["Recibido", "En curso", "Listo", "Entregado"];
const stepForStatus: Record<TrackingStatus, number> = { pending_review: 0, accepted: 0, confirmed: 1, in_progress: 1, ready: 2, fulfilled: 3, cancelled: -1, dismissed: -1 };
class TrackingFeedbackError extends Error {}

export default function OrderTrackingView() {
  const { hash } = useLocation();
  return <TrackingContent key={hash} token={hash.slice(1)} />;
}
function TrackingContent({ token }: { token: string }) {
  const [data, setData] = useState<OrderTracking | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [attempt, setAttempt] = useState(0);
  const [linkFeedback, setLinkFeedback] = useState("");
  useDocumentTitle(data ? `Tu pedido · ${data.business_name}` : "Seguimiento de tu pedido");
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setData(null); setError(""); setLoading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let finished = false;
    const read = async () => {
      if (controller.signal.aborted || inFlight || finished) return;
      if (document.hidden || !navigator.onLine) {
        timer = setTimeout(() => void read(), 30_000);
        return;
      }
      clearTimeout(timer);
      inFlight = true;
      await fetch("/api/v1/public/order-tracking", {
      method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
    }).then(async response => {
      if (!response.ok) throw new TrackingFeedbackError([404, 410].includes(response.status)
        ? "Este enlace ya no está disponible. Consulta al negocio para conocer el estado de tu solicitud."
        : "No pudimos consultar el estado. Intenta de nuevo en un momento.");
      const value = await response.json() as OrderTracking;
      if (!Object.hasOwn(statusCopy, value.status)) throw new TrackingFeedbackError("El estado todavía no está disponible. Vuelve a consultar en un momento.");
      return value;
    }).then(value => {
      if (!controller.signal.aborted) {
        setData(value); setError("");
        finished = ["fulfilled", "cancelled", "dismissed"].includes(value.status);
        if (!finished) timer = setTimeout(() => void read(), 30_000);
      }
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setData(null);
        setError(failure instanceof TrackingFeedbackError ? failure.message : "No pudimos consultar el estado. Revisa tu conexión e intenta de nuevo.");
        finished = true;
      }
    }).finally(() => { inFlight = false; if (!controller.signal.aborted) setLoading(false); });
    };
    const resume = () => { if (!document.hidden && navigator.onLine) void read(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void read();
    return () => {
      controller.abort(); clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [token, attempt]);
  const catalogPath = data?.catalog_path && /^\/catalogo\/[^/?#]+$/.test(data.catalog_path) ? data.catalog_path : null;
  const copy = data && statusCopy[data.status];
  const Icon = copy?.icon ?? Clock3;
  const currentStep = data ? stepForStatus[data.status] : -1;
  const isClosed = data?.status === "cancelled" || data?.status === "dismissed";
  const autoUpdating = data && !["fulfilled", "cancelled", "dismissed"].includes(data.status);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setLinkFeedback("Enlace copiado. Guárdalo para volver a consultar tu pedido."); }
    catch { setLinkFeedback("Copia la dirección de esta página desde tu navegador para guardar el seguimiento."); }
  };

  return <main className="min-h-screen bg-[#FAFAF7] px-4 py-6 text-kova-ink sm:py-10">
    <div className="mx-auto max-w-md space-y-5">
      <header><p className="flex items-center gap-2 text-xs font-medium text-kova-muted"><ShoppingBag className="h-4 w-4 text-kova-blue" aria-hidden="true" />Seguimiento de tu pedido</p>{data && <><h1 className="mt-3 line-clamp-2 text-xl font-semibold leading-tight tracking-tight sm:text-2xl" title={data.business_name}>{data.business_name}</h1><p className="mt-1.5 truncate text-xs text-kova-muted" title={data.branch_name}>{data.branch_name}</p></>}</header>
      {!token ? <section className="rounded-2xl border border-kova-border bg-white p-6"><h1 className="text-xl font-semibold">Abre el enlace de tu solicitud</h1><p className="mt-3 text-sm leading-relaxed text-kova-muted">Lo encontrarás al terminar de enviar tu pedido desde el menú digital del negocio.</p></section>
        : loading ? <section className="rounded-2xl border border-kova-border bg-white p-6" aria-busy="true"><h1 className="text-xl font-semibold">Tu solicitud</h1><p role="status" className="mt-3 text-sm text-kova-muted">Consultando el estado actual…</p></section>
          : error ? <section className="rounded-2xl border border-kova-border bg-white p-6"><h1 className="text-xl font-semibold">No pudimos abrir el seguimiento</h1><p role="alert" className="mt-3 text-sm leading-relaxed text-kova-muted">{error}</p><Button type="button" variant="outline" className="mt-4" onClick={() => setAttempt(value => value + 1)}>Volver a intentar</Button></section>
            : data && copy && <>
              <section aria-label="Estado de tu solicitud" className="overflow-hidden rounded-3xl border border-kova-border bg-white shadow-sm">
                <div className={`h-1 ${isClosed ? "bg-kova-border" : "bg-kova-blue"}`} />
                <div className="space-y-4 p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${isClosed ? "bg-kova-mist text-kova-muted" : "bg-kova-blue/10 text-kova-blue"}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>{data.folio && <span className="break-all text-right text-xs font-medium text-kova-muted">{data.folio}</span>}</div>
                  <div><h2 className="text-2xl font-semibold tracking-tight" role="status">{copy.title}</h2><p className="mt-2 text-sm leading-relaxed text-kova-muted">{copy.detail}</p></div>
                  {currentStep >= 0 && <ol aria-label="Progreso del pedido" className="grid grid-cols-4 gap-1 border-t border-kova-border pt-4">{steps.map((step, index) => <li key={step} aria-current={index === currentStep ? "step" : undefined} className="min-w-0"><div className="mb-2 flex items-center"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] ${index <= currentStep ? "bg-kova-blue text-white" : "bg-kova-mist text-kova-muted"}`}>{index < currentStep ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}</span>{index < steps.length - 1 && <span className={`h-px flex-1 ${index < currentStep ? "bg-kova-blue" : "bg-kova-border"}`} />}</div><span className={`block text-[10px] leading-snug ${index === currentStep ? "font-semibold text-kova-ink" : "text-kova-muted"}`}>{step}</span></li>)}</ol>}
                  <p className="text-xs text-kova-muted">{autoUpdating && <span className="mb-1 block">El estado se actualiza automáticamente cada 30 segundos.</span>}Último cambio: {new Date(data.updated_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                </div>
              </section>
              <div className="space-y-2.5"><Button type="button" className="w-full" onClick={() => void copyLink()}>Copiar enlace de seguimiento</Button>{linkFeedback && <p role="status" className="text-xs leading-relaxed text-kova-muted">{linkFeedback}</p>}<Button type="button" variant="outline" className="w-full" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Actualizar estado</Button>{catalogPath && <a href={catalogPath} className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-kova-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue"><span>Volver al menú</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></a>}</div>
              <section aria-labelledby="tracking-selection-title" className="overflow-hidden rounded-2xl border border-kova-border bg-white"><h2 id="tracking-selection-title" className="border-b border-kova-border px-4 py-3 text-sm font-semibold">Tu selección</h2><ul className="divide-y divide-kova-border px-4">{data.items.map((item, index) => <li key={`${index}-${item.product_name}`} className="flex items-start gap-3 py-3 text-sm"><span className="min-w-6 shrink-0 font-semibold tabular-nums">{item.quantity} ×</span><span className="break-words">{item.product_name}</span></li>)}</ul>{data.total_amount !== null && <div className="flex flex-wrap justify-between gap-2 border-t border-kova-border px-4 py-3 text-sm font-semibold"><span>Total registrado</span><span className="tabular-nums">{formatMoney(data.total_amount)} MXN</span></div>}<p className="px-4 pb-4 text-xs leading-relaxed text-kova-muted">{data.total_amount === null ? "El negocio confirma precios y total al revisar tu solicitud." : "Acuerda el pago directamente con el negocio. Aquí puedes consultar la preparación y entrega de tu pedido."}</p></section>
              <details className="group border-t border-kova-border"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue [&::-webkit-details-marker]:hidden">Acerca del seguimiento<ChevronDown className="h-4 w-4 text-kova-muted transition-transform group-open:rotate-180" aria-hidden="true" /></summary><div className="space-y-3 pb-3 pt-1 text-xs leading-relaxed text-kova-muted"><p>Aquí aparecen los cambios que registra el equipo. Mientras tu pedido siga activo, la página consulta su avance automáticamente. También puedes pulsar Actualizar estado.</p><p>El enlace vence el {new Date(data.expires_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}. Quien tenga este enlace puede consultar tu selección y su estado. Compártelo sólo con quien tú decidas.</p><p className="break-words">Negocio: {data.business_name}. Sucursal: {data.branch_name}.</p></div></details>
            </>}
      <footer className="pt-1 text-center text-[10px] text-kova-muted">Con tecnología de <span className="font-semibold text-kova-ink">Kova</span></footer>
    </div>
  </main>;
}
