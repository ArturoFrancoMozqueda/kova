import { useCallback, useEffect, useRef, useState } from "react";
import { type WorkspaceIdentity, useOnline, useOperationsRequest } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { ViewError } from "@/components/ui/view-states";
import { SUPPORT_MAILTO } from "@/lib/support";
import { launchMetaSignup, loadMetaSdk, type MetaSdk } from "./embeddedSignup";

type Availability = { available: boolean; can_manage: boolean; app_id: string | null;
  config_id: string | null; graph_version: string | null;
  state: "not_started" | "pending" | "processing" | "connected" | "review_required" | "failed" };
type Prepared = { session_id: string; nonce: string; expires_at: string };

export default function WhatsAppSignupPanel({ identity, onConnected, connected = false, sendEnabled = false }: {
  identity: WorkspaceIdentity; onConnected: () => void; connected?: boolean; sendEnabled?: boolean;
}) {
  const request = useOperationsRequest("/api/v1/messaging/onboarding", identity);
  const connectionRequest = useOperationsRequest("/api/v1/messaging/connection", identity);
  const online = useOnline();
  const [data, setData] = useState<Availability | null>(null);
  const [prepared, setPrepared] = useState<{ session: Prepared; sdk: MetaSdk } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const cancel = useRef<(() => void) | null>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try { const result = await request<Availability>();
      if (alive.current && generation.current === current) { setData(result); setLoadError(""); }
    } catch { if (alive.current && generation.current === current) {
      setData(null); setLoadError("No pudimos consultar el alta con Meta. Intenta de nuevo.");
    } }
  }, [request]);
  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; generation.current++; cancel.current?.(); };
  }, [load]);

  if (!data) return loadError ? <ViewError message={loadError} onRetry={() => void load()} retryLabel="Consultar de nuevo" />
    : <SectionSkeleton label="Consultando conexión con Meta…" variant="form" />;
  if (!data.available) return null;
  const needsReview = data.state === "review_required" || data.state === "processing";
  async function prepare() {
    if (!data?.app_id || !data.graph_version) return;
    setBusy(true); setError(""); setPrepared(null);
    try {
      const sdk = await loadMetaSdk(data.app_id, data.graph_version);
      const session = await request<Prepared>("/start", "POST", {});
      if (alive.current) setPrepared({ session, sdk });
    } catch { if (alive.current) setError("No pudimos preparar la conexión. Actualiza su estado y vuelve a intentar."); }
    finally { if (alive.current) setBusy(false); }
  }
  function authorize() {
    if (!prepared || !data?.config_id) return;
    if (new Date(prepared.session.expires_at).getTime() <= Date.now()) {
      setPrepared(null); setError("La preparación venció. Vuelve a conectar con Meta."); return;
    }
    setBusy(true); setError("");
    cancel.current = launchMetaSignup(prepared.sdk, data.config_id, result => {
      const submit = async () => {
        try {
          await request("/finish", "POST", { session_id: prepared.session.session_id,
            nonce: prepared.session.nonce, ...result });
          if (alive.current) { setPrepared(null); onConnected(); await load(); }
        } catch {
          if (alive.current) { setPrepared(null); setError("No se completó la conexión. Consulta el estado antes de volver a intentar."); await load(); }
        } finally { if (alive.current) setBusy(false); }
      };
      void submit();
    }, reason => {
      if (!alive.current) return;
      setBusy(false); setPrepared(null);
      setError(reason === "cancelled" ? "Cerraste la autorización. Puedes volver a conectar cuando quieras."
        : reason === "incomplete" ? "Meta no completó el alta de un número compatible. Consulta a soporte para revisar tu caso."
          : "Meta no pudo completar la autorización. Intenta de nuevo más tarde.");
    });
  }
  return <section aria-label="Conectar con Meta" className="space-y-4 rounded-2xl border border-kova-border bg-white p-6">
    <div><h2 className="text-xl font-semibold">{connected ? "Autorización y respuestas" : "Conecta tu número con Meta"}</h2>
      <p className="mt-2 max-w-2xl text-sm text-kova-muted">{connected
        ? "Puedes renovar la autorización del mismo número cuando Meta lo solicite o si la conexión requiere revisión."
        : "Autoriza tu cuenta y verifica el número del negocio en Meta. Kova guardará la conexión para esta sucursal; no tendrás que copiar claves ni configurar servidores."}</p></div>
    {!connected && <p className="text-sm">Si ya usas el número en la app de WhatsApp Business, consulta a soporte antes de continuar para revisar si puedes conservarla.</p>}
    {!data.can_manage ? <p className="text-sm">El dueño del negocio debe autorizar esta conexión.</p> : needsReview ? <>
      <p role="status" className="text-sm">{data.state === "processing" ? "Estamos verificando la autorización. Actualiza su estado en unos momentos." : "La autorización requiere revisión. No repitas el alta ni elimines tu cuenta de WhatsApp."}</p>
      <Button variant="outline" onClick={() => void load()}>Consultar estado de la conexión</Button>
      <a className="ml-3 text-sm underline" href={`${SUPPORT_MAILTO}?subject=Revisar%20conexi%C3%B3n%20de%20WhatsApp`}>Solicitar revisión</a>
    </> : <>
      {!connected && <p className="text-sm text-kova-muted">Los envíos comienzan pausados. La conexión guardada no confirma la entrega de mensajes. Meta puede solicitar información del negocio y un método de pago.</p>}
      <Button disabled={busy || !online} onClick={prepared ? authorize : () => void prepare()}>
        {busy ? "Conectando…" : prepared ? "Autorizar en Meta" : data.state === "connected" ? "Renovar autorización con Meta" : "Conectar WhatsApp"}
      </Button>
      {prepared && <p role="status" className="text-sm">Todo listo. Continúa con Meta para elegir y autorizar el número de esta sucursal.</p>}
    </>}
    {connected && data.can_manage && <div className="space-y-2 border-t border-kova-border pt-4">
      <p className="text-sm">Las respuestas se envían sólo cuando tu equipo confirma cada mensaje, con permiso del cliente y dentro de la ventana de atención.</p>
      <Button variant="outline" disabled={busy || !online} onClick={() => {
        setBusy(true); setError("");
        void connectionRequest("/sending", "PATCH", { enabled: !sendEnabled }).then(() => {
          if (alive.current) onConnected();
        }).catch(() => { if (alive.current) setError("No pudimos cambiar el permiso de respuestas. Consulta el estado de la conexión."); })
          .finally(() => { if (alive.current) setBusy(false); });
      }}>{sendEnabled ? "Pausar respuestas desde Kova" : "Habilitar respuestas desde Kova"}</Button>
    </div>}
    {!online && <p role="status" className="text-sm">Conéctate a internet para administrar WhatsApp.</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </section>;
}
