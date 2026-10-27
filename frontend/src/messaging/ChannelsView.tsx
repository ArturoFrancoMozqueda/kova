import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { OperationsError, OperationsSession, useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError } from "@/components/ui/view-states";
import { SUPPORT_MAILTO } from "@/lib/support";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type Readiness = { status: "not_connected" | "connected" | "configuration_error"; send_enabled: boolean; webhook_enabled: boolean; tenant_mapping_verified: boolean; checklist: { key: string; title: string; description: string; status: "required" | "review_required" }[] };

export default function ChannelsView() {
  useDocumentTitle("Canales del negocio");
  return <OperationsSession>{identity => <ChannelsWorkspace identity={identity} />}</OperationsSession>;
}

function ChannelsWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1/messaging/readiness", identity);
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await request<Readiness>();
      if (alive.current && current === generation.current) { setData(result); setError(""); }
    } catch (e) { if (alive.current && current === generation.current) {
      setData(null);
      setError(e instanceof OperationsError && [401, 403].includes(e.status)
        ? "No tienes acceso a la configuración de WhatsApp. Consulta al dueño del negocio."
        : e instanceof OperationsError && e.status === 429
          ? "Espera un momento antes de volver a consultar WhatsApp."
          : "No pudimos consultar WhatsApp. Revisa tu conexión e intenta de nuevo.");
    } }
  }, [request]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return <ViewLayout className="space-y-6">
    <ViewHeader eyebrow="Atención al cliente" title="Canales del negocio" meta="Conecta las conversaciones con tus clientes, pedidos y seguimiento." />
    {error && <ViewError message={error} onRetry={() => void load()} retryLabel="Consultar de nuevo" />}
    {!data && !error && <p role="status">Consultando preparación de WhatsApp…</p>}
    {data && <>
      <section aria-label="Estado de WhatsApp" className="space-y-3 rounded-2xl border border-kova-border bg-white p-6">
        <h2 className="text-xl font-semibold">WhatsApp Business</h2><p className="inline-block rounded-full bg-kova-mist px-3 py-1 text-sm font-medium">{data.status === "connected" ? "Conexión configurada" : data.status === "configuration_error" ? "Requiere revisión" : "Sin conectar"}</p>
        {data.status === "connected" ? <>
          <p className="text-sm">El número está vinculado a esta sucursal. {data.send_enabled ? "Puedes responder desde la bandeja, sujeto al permiso de contacto y la ventana de atención." : "Los envíos están pausados; puedes revisar los mensajes que lleguen a la bandeja."}</p>
          <p className="text-sm text-kova-muted">Este estado confirma la configuración guardada. La entrega de cada mensaje se confirma por separado.</p>
          <Link className="inline-flex min-h-11 items-center text-sm underline" to="/inbox">Abrir bandeja de atención</Link>
        </> : <>
        <p className="text-sm">El equipo de Kova te acompaña a conectar el número de tu negocio con Meta. Contacta a soporte para revisar tu caso y los requisitos.</p>
        <p className="max-w-2xl text-sm text-kova-muted">El equipo de Kova te ayuda a verificar tu número y revisar cómo conservar tu WhatsApp actual.</p>
        <p className="text-sm">No se envían ni reciben mensajes automáticos desde esta preparación. Los enlaces del catálogo abren una conversación directamente con el negocio.</p>
        <a href={`${SUPPORT_MAILTO}?subject=Conectar%20WhatsApp%20con%20Kova`} className="inline-flex min-h-11 items-center rounded-xl bg-kova-blue px-4 py-3 text-sm font-medium text-white">Solicitar ayuda para conectar WhatsApp</a>
        {data.status === "configuration_error" && <p role="alert" className="text-sm">La configuración requiere revisión por el equipo de Kova. Los envíos permanecen bloqueados.</p>}
        </>}
      </section>
      <details aria-label="Preparación del canal" className="space-y-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Qué revisaremos contigo</summary><p className="text-sm text-kova-muted">Esta guía explica la preparación; no indica que los pasos ya estén completados.</p><ol className="grid gap-4 md:grid-cols-2">{data.checklist.map((item, index) => <li key={item.key} className="min-w-0 rounded-2xl border border-kova-border bg-white p-5"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-kova-muted">Paso {index + 1} · {data.status === "connected" ? "Requisito del canal" : item.status === "required" ? "Por configurar" : "Requiere revisión"}</p><h3 className="break-words font-semibold">{item.title}</h3><p className="mt-3 break-words text-sm text-kova-muted">{item.description}</p></li>)}</ol></details>
      <section className="rounded-2xl border border-kova-border p-6"><h2 className="font-semibold">Puedes avanzar desde Kova</h2><p className="mt-2 text-sm text-kova-muted">Publica tu catálogo y registra permisos de contacto por cliente. Esto no activa campañas ni reemplaza el alta del canal en Meta.</p><div className="mt-4 flex flex-wrap gap-4"><Link to="/settings/public-catalog" className="inline-flex min-h-11 items-center text-sm underline">Preparar catálogo y QR</Link><Link to="/crm" className="inline-flex min-h-11 items-center text-sm underline">Revisar clientes y consentimientos</Link><a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">Revisar alta oficial de Meta</a></div></section>
      <Button variant="outline" onClick={() => void load()}>Volver a consultar requisitos</Button>
    </>}
  </ViewLayout>;
}
