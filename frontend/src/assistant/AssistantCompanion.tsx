import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, LockKeyhole, X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getActiveBranchId } from "@/branches/activeBranch";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assistantApi, type Capabilities, type Identity, type Preferences, type Resource, type Usage } from "./api";
import { AssistantComposer, AssistantConversation, AssistantUsage, AssistantWelcome } from "./AssistantChat";

// Only presentation uses the route. Never send DOM, URLs, query parameters or
// unseen page data as model context. Suggestions are explicit user questions.
const surfaces = [
  { paths: ["/register", "/caja"], title: "Caja", suggestion: "¿Cómo preparo mi negocio para registrar una venta?" },
  { paths: ["/catalog", "/catalogo"], title: "Catálogo", suggestion: "Ayúdame a organizar mis productos y categorías" },
  { paths: ["/inventory", "/inventario"], title: "Inventario", suggestion: "¿Qué productos necesitan mi atención?" },
  { paths: ["/reports", "/reportes"], title: "Análisis", suggestion: "Revisa mis ventas de este mes" },
  { paths: ["/settings"], title: "Configuración", suggestion: "Ayúdame a configurar el perfil y ticket de mi negocio" },
  { paths: ["/orders", "/ventas", "/ordenes"], title: "Ventas", suggestion: "¿Cómo puedo revisar los resultados de mis ventas?" },
  { paths: ["/shifts", "/turnos"], title: "Turnos", suggestion: "¿Qué debo revisar antes de cerrar mi turno?" },
];
const fallback = { title: "Tu negocio", suggestion: "Revisa mis ventas, productos más vendidos e inventario. ¿Qué debería atender?" };

export function AssistantCompanion({ enabled, suspended = false }: { enabled: boolean; suspended?: boolean }) {
  const { state } = useAuth();
  if (!enabled || state.status !== "authenticated" || state.sessionMode !== "online" || !["owner", "manager"].includes(state.user.role)) return null;
  const identity = { tenantId: state.tenantId, userId: state.user.id, branchId: getActiveBranchId(state.tenantId, state.user.id) };
  return <CompanionSession key={`${identity.tenantId}:${identity.userId}:${identity.branchId}:${state.user.role}`} identity={identity} tenantName={state.tenantName} suspended={suspended} />;
}

function CompanionSession({ identity, tenantName, suspended }: { identity: Identity; tenantName: string; suspended: boolean }) {
  const { pathname } = useLocation();
  const surface = surfaces.find(item => item.paths.some(path => pathname === path || pathname.startsWith(`${path}/`))) ?? fallback;
  const register = surface.title === "Caja";
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const controller = useRef(new AbortController());
  const api = useMemo(() => assistantApi({ tenantId: identity.tenantId, userId: identity.userId, branchId: identity.branchId }, () => controller.current.signal), [identity.tenantId, identity.userId, identity.branchId]);
  const [open, setOpen] = useState(false);
  const [modalPresent, setModalPresent] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Resource[]>([]);
  const [run, setRun] = useState<Resource | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ content: string; key: string } | null>(null);
  const alive = useRef(true);
  const generating = !!run && ["queued", "running"].includes(run.status);
  const runId = run?.id;
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);

  useEffect(() => {
    alive.current = true;
    if (controller.current.signal.aborted) controller.current = new AbortController();
    return () => { alive.current = false; controller.current.abort(); };
  }, []);
  useEffect(() => {
    // Let checkout, tours and confirmation dialogs own focus and interaction.
    let present = false;
    const update = () => {
      const next = !!document.querySelector('[aria-modal="true"], [aria-labelledby="first-use-tour-title"]:not([aria-hidden="true"])');
      if (next !== present) { present = next; setModalPresent(next); }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "aria-hidden"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (modalPresent || suspended || pathname.startsWith("/assistant")) setOpen(false);
  }, [modalPresent, suspended, pathname]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.target instanceof Node && panel.current?.contains(event.target)) {
        event.stopPropagation(); close();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, close]);
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    void Promise.all([
      api<Capabilities>("/capabilities"), api<Preferences>("/preferences"), api<Usage>("/usage"),
      conversation ? api<{ messages: Resource[] }>(`/conversations/${conversation}`) : Promise.resolve(null),
      runId ? api<Resource>(`/runs/${runId}`) : Promise.resolve(null),
    ]).then(([capabilities, preferences, used, chat, result]) => {
        if (!stopped && alive.current) {
          setCaps(capabilities); setPrefs(preferences); setUsage(used);
          if (chat) setMessages(chat.messages);
          if (result) setRun(result);
        }
      }).catch(e => { if (!stopped && alive.current) setError(e instanceof Error ? e.message : "No pudimos cargar el asistente."); });
    return () => { stopped = true; };
  }, [open, api, conversation, runId]);
  useEffect(() => {
    if (!open || !runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(() => void poll(), 10000); return; }
      try {
        const result = await api<Resource>(`/runs/${runId}`);
        if (stopped || !alive.current) return;
        setRun(result);
        if (["queued", "running"].includes(result.status)) { timer = setTimeout(() => void poll(), attempts++ < 3 ? 2000 : 5000); return; }
        if (conversation) {
          const [data, used] = await Promise.all([api<{ messages: Resource[] }>(`/conversations/${conversation}`), api<Usage>("/usage")]);
          if (!stopped && alive.current) { setMessages(data.messages); setUsage(used); }
        }
      } catch (e) { if (!stopped && alive.current) setError(e instanceof Error ? e.message : "No pudimos recuperar la consulta."); }
    };
    // Also recover a run that finished while the companion was closed.
    timer = setTimeout(() => void poll(), generating ? 2000 : 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, open, runId, generating, conversation]);

  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { if (alive.current && !(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "No pudimos completar la consulta."); }
    finally { if (alive.current) setBusy(false); }
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || busy || generating || !caps?.enabled || !caps.inference_ready || !prefs?.chat_consent) return;
    void act(async () => {
      let id = conversation;
      if (!id) {
        const created = await api<Resource>("/conversations", "POST", { title: question.trim().slice(0, 80) });
        if (!alive.current) return;
        id = created.id; setConversation(id);
      }
      const content = question.trim();
      const turn = pending.current?.content === content ? pending.current : { content, key: crypto.randomUUID() };
      pending.current = turn;
      const createdRun = await api<Resource>(`/conversations/${id}/messages`, "POST", { content }, turn.key);
      if (!alive.current) return;
      setRun(createdRun); setQuestion(""); pending.current = null;
      const data = await api<{ messages: Resource[] }>(`/conversations/${id}`);
      if (alive.current) setMessages(data.messages);
    });
  };
  const fullPath = conversation ? `/assistant?conversation=${encodeURIComponent(conversation)}${run ? `&run=${encodeURIComponent(run.id)}` : ""}` : "/assistant";
  const hidden = suspended || modalPresent || pathname.startsWith("/assistant");

  return <div hidden={hidden} className={cn("fixed right-4 z-30 print:hidden xl:right-6", register ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom))] xl:bottom-6 xl:right-[460px]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] xl:bottom-6", hidden && "hidden")}>
    {open ? <div ref={panel} id={panelId} role="dialog" aria-modal="false" aria-label="Asistente Kova" tabIndex={-1}
      className={cn("absolute bottom-16 right-0 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-kova-border bg-white shadow-kova-hero focus:outline-none xl:h-[min(660px,calc(100dvh-7rem))] xl:max-h-[min(660px,calc(100dvh-7rem))]", register ? "max-h-[calc(100dvh-15rem-env(safe-area-inset-bottom))]" : "max-h-[calc(100dvh-11rem-env(safe-area-inset-bottom))]")}>
      <header className="flex shrink-0 items-center gap-3 border-b border-kova-border px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-kova-grad-sky text-kova-blue"><LogoMark size={28} /></span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Asistente Kova</h2><p className="mt-1 truncate text-[11px] text-kova-muted">{tenantName} · {surface.title}</p></div>
        <Link to={fullPath} onClick={() => setOpen(false)} aria-label="Ampliar conversación" className="flex h-11 w-11 items-center justify-center rounded-kova-md text-kova-muted hover:bg-kova-mist focus-visible:outline-kova-blue"><ArrowUpRight size={18} /></Link>
        <Button size="icon" variant="ghost" aria-label="Cerrar asistente" onClick={close} className="text-kova-muted"><X /></Button>
      </header>
      <AssistantConversation compact messages={messages} run={run} busy={busy} onCancel={() => void act(async () => { if (!run) return; const result = await api<Resource>(`/runs/${run.id}/cancel`, "POST"); if (alive.current) setRun(result); })} empty={caps?.enabled && prefs ? <AssistantWelcome compact disabled={busy || generating} suggestion={surface.suggestion} onSuggestion={text => { setQuestion(text); document.getElementById(`${panelId}-question`)?.focus(); }} /> : null}>
        {error ? <p role="alert" className="text-sm text-kova-danger">{error}</p> : null}
        {!caps || !prefs ? <p role="status" className="py-4 text-sm text-kova-muted">Cargando el asistente…</p> : !caps.enabled ? <p className="text-sm">El asistente aún no está habilitado para este negocio.</p> : <>
          {run?.data.proposal_id ? <p className="rounded-kova-md bg-kova-mist p-3 text-sm leading-6">Preparé una propuesta. Abre el asistente completo para revisar y confirmar cada cambio.</p> : null}
          {!prefs.chat_consent ? <div className="space-y-3 rounded-xl border border-kova-border bg-kova-mist/50 p-4"><p className="flex items-center gap-2 text-xs font-medium"><LockKeyhole size={14} />Conversación privada · Sucursal activa</p><p className="text-sm leading-6 text-kova-muted">Para responder, enviaremos a la IA tu pregunta y el contexto autorizado mínimo del negocio. Puedes retirar el permiso en Preferencias.</p><Button disabled={busy} className="w-full bg-kova-blue hover:bg-kova-blue/90" onClick={() => void act(async () => { const saved = await api<Preferences>("/preferences", "PUT", { ...prefs, chat_consent: true }); if (alive.current) setPrefs(saved); })}>Aceptar y habilitar consultas</Button></div> : null}
          {!caps.inference_ready ? <p className="text-xs leading-5 text-kova-muted">La IA aún no está conectada. Puedes configurar el negocio y revisar tu seguimiento en el asistente completo.</p> : null}
          {usage && messages.length > 0 ? <AssistantUsage usage={usage} /> : null}
        </>}
      </AssistantConversation>
      {caps?.enabled && prefs?.chat_consent ? <AssistantComposer compact id={`${panelId}-question`} value={question} onChange={setQuestion} onSubmit={send} disabled={busy || generating} ready={caps.inference_ready} /> : null}
      <Link to={fullPath} onClick={() => setOpen(false)} className="flex min-h-11 shrink-0 items-center justify-center gap-2 border-t border-kova-border bg-kova-mist/30 px-3 text-xs font-medium text-kova-muted hover:bg-kova-mist">Abrir asistente completo<ArrowUpRight size={16} /></Link>
    </div> : null}
    <button ref={trigger} type="button" aria-label={open ? "Minimizar asistente Kova" : "Abrir asistente Kova"} aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { if (open) close(); else { setCaps(null); setError(""); setOpen(true); } }} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-kova-ink text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2 motion-reduce:transform-none">
      <LogoMark size={32} coreColor="white" />
    </button>
  </div>;
}
