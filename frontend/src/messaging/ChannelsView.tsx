import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { OperationsSession, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type Readiness = { status: "not_connected"; send_enabled: boolean; webhook_enabled: boolean; tenant_mapping_verified: boolean; checklist: { key: string; title: string; description: string; status: "required" | "review_required" }[] };

export default function ChannelsView() {
  useDocumentTitle("Canales del negocio");
  return <OperationsSession>{identity => <ChannelsWorkspace identity={identity} />}</OperationsSession>;
}

function ChannelsWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1/messaging/readiness", identity);
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const result = await request<Readiness>();
      if (alive.current) { setData(result); setError(""); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "No pudimos consultar la preparación del canal."); }
  }, [request]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return <ViewLayout className="space-y-6">
    <ViewHeader eyebrow="Atención al cliente" title="Canales del negocio" meta="Conoce los requisitos para conectar WhatsApp a tu negocio." />
    {error && <ViewError message={error} onRetry={() => void load()} retryLabel="Consultar de nuevo" />}
    {!data && !error && <p role="status">Consultando preparación de WhatsApp…</p>}
    {data && <>
      <section aria-label="Estado de WhatsApp" className="space-y-3 rounded-2xl border border-kova-border bg-white p-6">
        <h2 className="text-xl font-semibold">WhatsApp Business</h2><p className="inline-block rounded-full bg-kova-mist px-3 py-1 text-sm font-medium">Sin conectar</p>
        <p className="text-sm">La conexión de WhatsApp dentro de Kova sigue en preparación. Esta guía muestra los requisitos generales; todavía no comprueba la configuración de tu cuenta ni guarda avances.</p>
        <p className="max-w-2xl text-sm text-kova-muted">La app del celular y WhatsApp Cloud API requieren configuraciones distintas. Tener Meta o un dominio no confirma que el número esté listo para conectarse a Kova.</p>
        <p className="text-sm">No se envían ni reciben mensajes automáticos desde esta preparación. Los enlaces del catálogo abren una conversación directamente con el negocio.</p>
      </section>
      <section aria-label="Preparación del canal" className="space-y-4"><h2 className="text-xl font-semibold">Lo que necesitas revisar</h2><ol className="grid gap-4 md:grid-cols-2">{data.checklist.map((item, index) => <li key={item.key} className="min-w-0 rounded-2xl border border-kova-border bg-white p-5"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-kova-muted">Paso {index + 1} · {item.status === "required" ? "Por configurar" : "Requiere revisión"}</p><h3 className="break-words font-semibold">{item.title}</h3><p className="mt-3 break-words text-sm text-kova-muted">{item.description}</p></li>)}</ol></section>
      <section className="rounded-2xl border border-kova-border p-6"><h2 className="font-semibold">Puedes avanzar desde Kova</h2><p className="mt-2 text-sm text-kova-muted">Publica tu catálogo y registra permisos de contacto por cliente. Esto no activa campañas ni reemplaza el alta del canal en Meta.</p><div className="mt-4 flex flex-wrap gap-4"><Link to="/settings/public-catalog" className="inline-flex min-h-11 items-center text-sm underline">Preparar catálogo y QR</Link><Link to="/crm" className="inline-flex min-h-11 items-center text-sm underline">Revisar clientes y consentimientos</Link><a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">Revisar alta oficial de Meta</a></div></section>
      <Button variant="outline" onClick={() => void load()}>Volver a consultar requisitos</Button>
    </>}
  </ViewLayout>;
}
