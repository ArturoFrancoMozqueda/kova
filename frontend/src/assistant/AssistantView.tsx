import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Brain, FileText, LockKeyhole, MessageCircle, Plus, Settings2, ShieldCheck, Target, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getActiveBranchId } from "@/branches/activeBranch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfigurationDraft } from "./ConfigurationDraft";
import { AssistantComposer, AssistantConversation, AssistantUsage, AssistantWelcome } from "./AssistantChat";
import { LogoMark } from "@/components/brand/Logo";
import { assistantApi, type Capabilities, type Identity, type Preferences, type Resource, type Step, type Usage } from "./api";

const DEFAULT_PREFS: Preferences = { chat_consent: false, document_consent: false, email_opt_in: false, frequency: "weekly" };
const fieldClass = "min-h-11 w-full rounded-kova-md border border-kova-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue";
const labels: Record<string, string> = {
  public_name: "Nombre comercial", support_email: "Correo de soporte", support_phone: "Teléfono de soporte", timezone: "Zona horaria",
  receipt_business_name: "Nombre en el ticket", footer: "Pie del ticket", paper_width_mm: "Ancho del papel", tax_contact_text: "Texto fiscal del ticket",
  name: "Nombre", description: "Descripción", price_amount: "Precio", cost_price: "Costo", sku: "SKU", category_id: "Categoría",
  track_inventory: "Control de inventario", low_stock_threshold: "Umbral de stock", address: "Dirección", email: "Correo del invitado", role: "Rol",
  document_id: "Archivo revisado", sort_order: "Orden",
};
const actions: Record<string, string> = {
  business_profile: "Actualizar perfil", receipt: "Configurar ticket", category_create: "Crear categoría", category_update: "Actualizar categoría",
  product_create: "Crear producto", product_update: "Actualizar producto", branch_create: "Crear sucursal", branch_update: "Actualizar sucursal",
  catalog_import: "Importar catálogo", invitation: "Invitar colaborador",
};
const statuses: Record<string, string> = {
  queued: "En espera", running: "Consultando", indexing: "Preparando conocimiento", ready: "Listo", failed: "No se pudo completar",
  deferred: "Pendiente de cuota", deleting: "Retirando archivo", quarantined: "Archivo retenido", completed: "Completado", partial: "Aplicado parcialmente",
  pending_approval: "Pendiente de tu revisión", approved: "Aplicando pasos", cancelled: "Cancelado", pending: "Pendiente", reviewed: "Revisado",
  postponed: "Pospuesto", declared_completed: "Marcado por ti", verified: "Verificado por los datos",
};

function displayValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "Sin configurar";
  if (typeof value === "boolean") return value ? "Activado" : "Desactivado";
  if (key === "category_id") return String(value).startsWith("$step:") ? "Categoría creada en un paso anterior" : "Categoría seleccionada";
  if (key === "document_id") return "Mismo archivo de la vista previa";
  if (key === "price_amount" || key === "cost_price") return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value));
  return String(value);
}

function ChangeList({ steps }: { steps: Step[] }) {
  return <ol className="space-y-4">{steps.map((step, index) => <li key={index} className="rounded-kova-md border border-kova-border p-3">
    <p className="font-medium">{index + 1}. {actions[step.action] ?? "Configuración"}{step.result ? " · Guardado" : ""}</p>
    <dl className="mt-2 space-y-2 text-sm">{Object.entries(step.values).filter(([key, value]) => labels[key] && (!step.before || String(step.before[key]) !== String(value))).map(([key, value]) => <div key={key}>
      <dt className="text-kova-muted">{labels[key]}</dt><dd className="break-words">{step.before ? <span className="text-kova-muted">{displayValue(key, step.before[key])} → </span> : null}{displayValue(key, value)}</dd>
    </div>)}</dl>
  </li>)}</ol>;
}

export default function AssistantView() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return null;
  if (!["owner", "manager"].includes(state.user.role)) return <p className="p-6">El asistente está disponible para administradores.</p>;
  if (state.sessionMode === "offline") return <Card className="m-5 p-5">Conéctate para usar el asistente. Puedes seguir registrando ventas offline.</Card>;
  const identity = { tenantId: state.tenantId, userId: state.user.id, branchId: getActiveBranchId(state.tenantId, state.user.id) };
  return <AssistantWorkspace key={`${identity.tenantId}:${identity.userId}:${identity.branchId}:${state.user.role}`} identity={identity} tenantName={state.tenantName} />;
}

function AssistantWorkspace({ identity, tenantName }: { identity: Identity; tenantName: string }) {
  const { refresh: refreshIdentity } = useAuth();
  const apiController = useRef(new AbortController());
  const api = useMemo(() => assistantApi({ tenantId: identity.tenantId, userId: identity.userId, branchId: identity.branchId }, () => apiController.current.signal), [identity.tenantId, identity.userId, identity.branchId]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // Updating the continuation URL must not restart initial conversation recovery.
  const setParams = useCallback((values: Record<string, string>, options: { replace: boolean }) => {
    navigate({ search: new URLSearchParams(values).toString() }, options);
  }, [navigate]);
  const initialConversation = useRef(params.get("conversation"));
  const initialRun = useRef(params.get("run"));
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [tab, setTab] = useState("chat");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversations, setConversations] = useState<Resource[]>([]);
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Resource[]>([]);
  const [run, setRun] = useState<Resource | null>(null);
  const [input, setInput] = useState("");
  const pendingTurn = useRef<{ key: string; content: string } | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [documents, setDocuments] = useState<Resource[]>([]);
  const [memories, setMemories] = useState<Resource[]>([]);
  const [goals, setGoals] = useState<Resource[]>([]);
  const [tasks, setTasks] = useState<Resource[]>([]);
  const [proposals, setProposals] = useState<Resource[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Resource | null>(null);
  const [editingProposal, setEditingProposal] = useState(false);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("knowledge");
  const [memoryText, setMemoryText] = useState("");
  const [memoryShared, setMemoryShared] = useState(false);
  const [goalShared, setGoalShared] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalStart, setGoalStart] = useState("");
  const [goalEnd, setGoalEnd] = useState("");
  const [goalMetric, setGoalMetric] = useState("net_sales");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (apiController.current.signal.aborted) apiController.current = new AbortController();
    return () => { alive.current = false; apiController.current.abort(); };
  }, []);
  const refresh = useCallback(async () => {
    const [prefs, used, chats, docs, memory, target, todo, changes] = await Promise.all([
      api<Preferences>("/preferences"), api<Usage>("/usage"), api<Resource[]>("/conversations"), api<Resource[]>("/documents"),
      api<Resource[]>("/memory"), api<Resource[]>("/goals"), api<Resource[]>("/tasks"), api<Resource[]>("/proposals"),
    ]);
    if (!alive.current) return;
    setPreferences(prefs); setUsage(used); setConversations(chats); setDocuments(docs); setMemories(memory); setGoals(target); setTasks(todo); setProposals(changes);
  }, [api]);
  const loadConversation = useCallback(async (id: string) => {
    const data = await api<{ conversation: Resource; messages: Resource[] }>(`/conversations/${id}`);
    if (!alive.current) return;
    setConversation(id); setMessages(data.messages); setRun(null); pendingTurn.current = null;
    setParams({ conversation: id }, { replace: true });
  }, [api, setParams]);
  useEffect(() => {
    void (async () => {
      try {
        const caps = await api<Capabilities>("/capabilities");
        if (!alive.current) return;
        setCapabilities(caps);
        if (!caps.enabled) return;
        await refresh();
        if (initialConversation.current) await loadConversation(initialConversation.current);
        if (initialRun.current) {
          const recovered = await api<Resource>(`/runs/${initialRun.current}`);
          if (alive.current) setRun(recovered);
        }
      } catch (e) { if (alive.current && !(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "No pudimos cargar el asistente."); }
    })();
  }, [api, refresh, loadConversation]);

  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const poll = async () => {
      if (stopped) return;
      if (document.hidden) { timer = setTimeout(() => void poll(), 10000); return; }
      try {
        const result = await api<Resource>(`/runs/${run.id}`);
        if (stopped || !alive.current) return;
        if (["queued", "running"].includes(result.status)) { setRun(result); timer = setTimeout(() => void poll(), tries++ < 3 ? 2000 : 5000); return; }
        if (conversation) {
          const data = await api<{ messages: Resource[] }>(`/conversations/${conversation}`);
          if (!stopped && alive.current) setMessages(data.messages);
        }
        if (stopped || !alive.current) return;
        // Publishing the terminal run cleans up this effect. Finish recovering
        // its conversation first so that cleanup cannot discard the answer.
        setRun(result);
        await refresh();
      } catch (e) { if (!stopped && alive.current) setError(e instanceof Error ? e.message : "No pudimos recuperar la consulta."); }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, run, conversation, refresh]);

  useEffect(() => {
    if (!capabilities?.enabled || busy || !["followup", "memory"].includes(tab)) return;
    let stopped = false;
    const updateSignals = async () => {
      if (document.hidden) return;
      try {
        const [todo, targets] = await Promise.all([api<Resource[]>("/tasks"), api<Resource[]>("/goals")]);
        if (!stopped && alive.current) { setTasks(todo); setGoals(targets); }
      } catch (e) {
        if (!stopped && alive.current) setError(e instanceof Error ? e.message : "No pudimos actualizar el seguimiento.");
      }
    };
    void updateSignals();
    const timer = setInterval(() => void updateSignals(), 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, [api, capabilities?.enabled, tab, busy]);

  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { if (alive.current && !(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "No pudimos completar esta acción."); }
    finally { if (alive.current) setBusy(false); }
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || busy || generating || !(capabilities?.inference_ready || capabilities?.local_answers_ready) || !preferences.chat_consent) return;
    void act(async () => {
      let id = conversation;
      if (!id) {
        const created = await api<Resource>("/conversations", "POST", { title: input.slice(0, 80) || "Conversación privada" });
        if (!alive.current) return;
        id = created.id; setConversation(id);
      }
      const content = input.trim();
      const pending = pendingTurn.current?.content === content ? pendingTurn.current : { key: crypto.randomUUID(), content };
      pendingTurn.current = pending;
      const createdRun = await api<Resource>(`/conversations/${id}/messages`, "POST", { content }, pending.key);
      if (!alive.current) return;
      setRun(createdRun); setInput(""); pendingTurn.current = null;
      setParams({ conversation: id, run: createdRun.id }, { replace: true });
      const data = await api<{ messages: Resource[] }>(`/conversations/${id}`);
      if (alive.current) setMessages(data.messages);
    });
  };
  const savePreferences = () => void act(async () => { await api("/preferences", "PUT", preferences); await refresh(); });
  const confirm = () => void act(async () => {
    if (!selectedProposal) return;
    const result = await api<Resource>(`/proposals/${selectedProposal.id}/confirm`, "POST", { fingerprint: selectedProposal.data.fingerprint });
    if (!alive.current) return;
    setSelectedProposal(result); await refresh();
    window.dispatchEvent(new Event("kova-branches-updated"));
    if (result.status === "completed" && result.data.steps?.some(step => step.action === "business_profile")) void refreshIdentity();
  });
  const generating = run && ["queued", "running"].includes(run.status);

  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-kova-blue/10 bg-kova-grad-sky text-kova-blue"><LogoMark size={30} /></span><div><h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Tu asistente de negocio</h1><p className="mt-1 text-xs text-kova-muted">{tenantName} · Sucursal activa</p></div></div>
      {usage ? <AssistantUsage usage={usage} /> : null}
    </header>
    {error ? <div role="alert" className="rounded-kova-md border border-kova-danger/30 bg-kova-danger/5 p-4 text-sm">{error}<Button variant="ghost" onClick={() => void act(refresh)} className="ml-2">Volver a cargar</Button></div> : null}
    {!capabilities ? <Card className="p-5" role="status">Cargando el asistente…</Card> : !capabilities.enabled ? <Card className="p-6"><h2 className="font-semibold">Disponible próximamente para tu negocio</h2><p className="mt-2 text-sm text-kova-muted">El asistente se habilita después de verificar aislamiento, calidad y capacidad. Tus herramientas actuales siguen disponibles.</p><Link className="mt-4 inline-flex min-h-11 items-center text-kova-blue underline" to="/settings">Abrir configuración</Link></Card> : <>
      <nav aria-label="Secciones del asistente" className="flex gap-1 overflow-x-auto border-b border-kova-border pb-2">{[
        ["chat", "Conversaciones", MessageCircle], ["configuration", "Configurar", ShieldCheck], ["files", "Archivos", FileText], ["memory", "Memoria y objetivos", Brain], ["followup", "Seguimiento", Target], ["preferences", "Preferencias", Settings2],
      ].map(([key, label, Icon]) => { const Glyph = Icon as typeof Brain; return <Button key={String(key)} variant="ghost" className={tab === key ? "bg-kova-blue/10 text-kova-blue hover:bg-kova-blue/10" : "text-kova-muted"} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(String(key))}><Glyph size={16} />{String(label)}</Button>; })}</nav>
      {tab === "chat" ? <div className="overflow-hidden rounded-2xl border border-kova-border bg-white shadow-kova-card lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-kova-border bg-kova-mist/50 p-3 lg:flex lg:flex-col lg:border-b-0 lg:border-r lg:p-4">
          <Button variant="outline" className="w-full justify-start" disabled={busy || !!generating} onClick={() => { setConversation(null); setMessages([]); setRun(null); pendingTurn.current = null; setParams({}, { replace: true }); }}><Plus />Nueva conversación</Button>
          <details className="mt-2 lg:hidden"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-kova-muted focus-visible:outline-kova-blue">Historial de conversaciones · {conversations.length}</summary><div className="max-h-48 space-y-1 overflow-y-auto">{conversations.length === 0 ? <p className="p-2 text-xs text-kova-muted">Tu primera consulta aparecerá aquí.</p> : conversations.map(item => <button key={item.id} disabled={busy || !!generating} aria-current={conversation === item.id ? "page" : undefined} className={`min-h-11 w-full break-words rounded-kova-md p-2 text-left text-sm focus-visible:outline-kova-blue ${conversation === item.id ? "bg-white font-medium text-kova-blue" : "hover:bg-white"}`} onClick={() => void act(() => loadConversation(item.id))}>{item.data.title}</button>)}</div></details>
          <div className="mt-6 hidden min-h-0 flex-1 lg:block"><p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-kova-muted">Tus conversaciones</p><div className="max-h-[460px] space-y-1 overflow-y-auto">{conversations.length === 0 ? <p className="px-2 text-xs leading-5 text-kova-muted">Tu primera consulta aparecerá aquí.</p> : conversations.map(item => <button key={item.id} disabled={busy || !!generating} aria-current={conversation === item.id ? "page" : undefined} className={`flex min-h-11 w-full items-start gap-2 rounded-kova-md p-2 text-left text-sm focus-visible:outline-kova-blue ${conversation === item.id ? "bg-white font-medium text-kova-blue shadow-kova-card" : "text-kova-muted hover:bg-white"}`} onClick={() => void act(() => loadConversation(item.id))}><MessageCircle size={14} className="mt-1 shrink-0" /><span className="min-w-0 break-words line-clamp-2">{item.data.title}</span></button>)}</div></div>
          <div className="mt-4 hidden border-t border-kova-border pt-3 lg:block"><p className="flex items-center gap-2 text-[11px] text-kova-muted"><LockKeyhole size={13} />Privadas para tu usuario</p>{conversation ? <Button variant="ghost" className="mt-2 w-full justify-start px-2 text-xs text-kova-muted" disabled={busy || !!generating} onClick={() => void act(async () => { await api(`/conversations/${conversation}`, "DELETE"); setConversation(null); setMessages([]); setRun(null); setParams({}, { replace: true }); await refresh(); })}><Trash2 />Borrar conversación</Button> : null}</div>
        </aside>
        <div className="flex h-[min(720px,calc(100dvh-230px))] min-h-[540px] min-w-0 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-kova-border px-4 py-3 sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-medium">{conversations.find(item => item.id === conversation)?.data.title ?? "Una mirada a tu negocio"}</p><p className="mt-1 flex items-center gap-1.5 text-[11px] text-kova-muted"><LockKeyhole size={12} />Solo para ti · Sucursal activa</p></div><span className="flex shrink-0 items-center gap-1.5 rounded-full border border-kova-border px-2.5 py-1 text-[10px] text-kova-muted"><span className={`h-1.5 w-1.5 rounded-full ${capabilities.inference_ready ? "bg-kova-blue" : "bg-kova-muted"}`} />{capabilities.inference_ready ? "Disponible" : "IA sin conectar"}</span></header>
          <AssistantConversation messages={messages} run={run} busy={busy} onCancel={() => void act(async () => { if (!run) return; const cancelled = await api<Resource>(`/runs/${run.id}/cancel`, "POST"); if (alive.current) setRun(cancelled); })} empty={<AssistantWelcome localOnly={!capabilities.inference_ready} disabled={busy || !!generating} onSuggestion={text => { setInput(text); document.getElementById("assistant-question")?.focus(); }} />} />
          {!preferences.chat_consent ? <div className="shrink-0 border-t border-kova-border bg-kova-mist/50 p-4 sm:px-8"><div className="mx-auto max-w-2xl"><p className="text-sm leading-6 text-kova-muted">Para responder, se enviará a {capabilities.provider_name ?? "el proveedor de IA"} tu consulta y el contexto autorizado mínimo de este negocio. Puedes retirar este permiso en Preferencias.</p><Button className="mt-3 bg-kova-blue hover:bg-kova-blue/90" disabled={busy} onClick={() => void act(async () => { await api("/preferences", "PUT", { ...preferences, chat_consent: true }); await refresh(); })}>Aceptar y habilitar consultas</Button></div></div> : <>
            {!capabilities.inference_ready ? <p className="shrink-0 bg-kova-mist/50 px-4 py-2 text-xs leading-5 text-kova-muted sm:px-8">La IA aún no está conectada. Puedes consultar ventas, reposición de inventario y guías con las preguntas sugeridas.</p> : null}
            <AssistantComposer id="assistant-question" value={input} onChange={setInput} onSubmit={send} disabled={busy || !!generating} ready={capabilities.inference_ready || !!capabilities.local_answers_ready} />
          </>}
          {conversation ? <Button variant="ghost" className="shrink-0 rounded-none text-xs text-kova-muted lg:hidden" disabled={busy || !!generating} onClick={() => void act(async () => { await api(`/conversations/${conversation}`, "DELETE"); setConversation(null); setMessages([]); setRun(null); setParams({}, { replace: true }); await refresh(); })}><Trash2 />Borrar conversación</Button> : null}
        </div>
      </div> : null}
      {tab === "configuration" ? <Card className="space-y-5 p-5"><h2 className="text-lg font-semibold">Configurar con tu asistente</h2><p className="text-sm text-kova-muted">Prepara los datos aunque el proveedor de IA todavía no esté conectado. Cada propuesta requiere tu confirmación.</p>{capabilities.configuration ? <ConfigurationDraft busy={busy} onPreview={steps => void act(async () => { const proposal = await api<Resource>("/proposals", "POST", { steps }); if (alive.current) { setSelectedProposal(proposal); setEditingProposal(false); } await refresh(); })} /> : <p className="text-sm text-kova-muted">La configuración asistida aún no está habilitada.</p>}</Card> : null}
      {tab === "files" ? <Card className="space-y-5 p-5"><div><h2 className="text-lg font-semibold">Archivos de tu negocio</h2><p className="mt-1 text-sm text-kova-muted">Un catálogo cambia datos después de confirmar. Un documento aporta conocimiento y fuentes.</p></div>
        <label className="block text-sm">¿Para qué es el archivo?<select className={`${fieldClass} mt-2`} value={purpose} onChange={event => { setPurpose(event.target.value); setReplacement(null); }}><option value="knowledge">Conocimiento: PDF, DOCX, TXT o Markdown</option><option value="catalog">Importar catálogo: CSV o XLSX</option></select></label>
        {purpose === "knowledge" && !preferences.document_consent ? <p className="text-sm text-kova-muted">Activa el permiso de documentos en Preferencias antes de cargar. Su texto se procesará con IA externa.</p> : null}
        {replacement ? <p className="text-sm">Selecciona la nueva versión. La anterior se retirará cuando termine de prepararse.<Button variant="ghost" onClick={() => setReplacement(null)}>Cancelar reemplazo</Button></p> : null}
        <label className="block text-sm">Seleccionar archivo<input type="file" className={`${fieldClass} mt-2`} accept={purpose === "catalog" ? ".csv,.xlsx" : ".pdf,.docx,.txt,.md"} disabled={busy || !capabilities.documents || purpose === "knowledge" && !preferences.document_consent} onChange={event => { const file = event.target.files?.[0]; if (!file) return; event.target.value = ""; void act(async () => { await api(`/documents?filename=${encodeURIComponent(file.name)}&purpose=${purpose}${replacement ? `&replaces=${replacement}` : ""}`, "POST", file); if (alive.current) setReplacement(null); await refresh(); }); }} /></label>
        <Button variant="outline" disabled={busy} onClick={() => void act(refresh)}>Actualizar estado</Button>
        {documents.length === 0 ? <p className="text-sm text-kova-muted">Todavía no hay archivos. Sube una política, un manual o tu catálogo.</p> : documents.map(doc => <div key={doc.id} className="space-y-3 rounded-kova-md border border-kova-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="break-all font-medium">{doc.data.filename}</h3><p className="text-xs text-kova-muted">{statuses[doc.status] ?? doc.status} · {doc.shared ? "Compartido con administradores" : "Privado"}</p></div><Button variant="ghost" disabled={busy || !doc.can_edit} onClick={() => void act(async () => { await api(`/documents/${doc.id}`, "DELETE"); await refresh(); })}><Trash2 />Retirar</Button></div>
          {doc.data.error ? <p role="alert" className="text-sm text-kova-danger">{doc.data.error}</p> : null}{doc.data.ocr ? <p className="text-sm text-kova-muted">Texto obtenido por OCR. Revisa cifras y nombres antes de usarlos.</p> : null}
          {doc.can_edit && doc.data.purpose === "knowledge" && doc.status === "ready" ? <Button variant="outline" disabled={busy} onClick={() => { setPurpose("knowledge"); setReplacement(doc.id); }}>Reemplazar versión</Button> : null}
          {doc.can_edit && doc.data.purpose === "knowledge" && doc.status === "ready" ? <Button variant="outline" disabled={busy} onClick={() => void act(async () => { await api(`/documents/${doc.id}/sharing`, "PATCH", { shared: !doc.shared }); await refresh(); })}>{doc.shared ? "Volver privado" : "Compartir con administradores"}</Button> : null}
          {doc.data.preview ? <><p className="text-sm">{doc.data.preview.valid_rows} productos válidos · {doc.data.preview.error_rows} filas con errores</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left text-xs text-kova-muted">Primeras filas del archivo. La importación valida el archivo completo.</caption><thead><tr><th className="p-2">Fila</th><th className="p-2">Producto</th><th className="p-2">Revisión</th></tr></thead><tbody>{doc.data.preview.rows.slice(0, 25).map((row, i) => <tr key={i}><td className="p-2">{row.row_number}</td><td className="p-2">{row.normalized?.name ?? "Sin nombre"}</td><td className="p-2">{row.errors.length ? row.errors.join(" · ") : "Listo"}</td></tr>)}</tbody></table></div><Button disabled={busy || doc.data.preview.error_rows > 0 || !capabilities.configuration} onClick={() => void act(async () => { const proposal = await api<Resource>("/proposals", "POST", { steps: [{ action: "catalog_import", values: { document_id: doc.id } }] }); if (alive.current) setSelectedProposal(proposal); await refresh(); })}>Revisar importación</Button></> : null}
        </div>)}
      </Card> : null}
      {tab === "memory" ? <div className="grid gap-4 lg:grid-cols-2"><Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Qué recuerda</h2><p className="text-sm text-kova-muted">Solo guardamos lo que confirmas aquí. Puedes corregirlo u olvidarlo cuando quieras.</p><form onSubmit={event => { event.preventDefault(); void act(async () => { await api(editingMemory ? `/memory/${editingMemory}` : "/memory", editingMemory ? "PUT" : "POST", { content: memoryText, shared: memoryShared }); if (alive.current) { setMemoryText(""); setEditingMemory(null); } await refresh(); }); }} className="space-y-3"><label className="block text-sm">Acuerdo o preferencia<textarea className={`${fieldClass} mt-2 min-h-24`} value={memoryText} maxLength={2000} required onChange={event => setMemoryText(event.target.value)} /></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={memoryShared} onChange={event => setMemoryShared(event.target.checked)} />Compartir con administradores del negocio</label><Button type="submit" disabled={busy}>{editingMemory ? "Guardar corrección" : "Confirmar recuerdo"}</Button></form>
        {memories.length === 0 ? <p className="text-sm text-kova-muted">No hay recuerdos guardados.</p> : memories.map(memory => <div key={memory.id} className="rounded-kova-md border border-kova-border p-3"><p className="whitespace-pre-wrap break-words text-sm">{memory.data.content}</p><p className="mt-1 text-xs text-kova-muted">{memory.shared ? "Compartido" : "Solo para ti"}</p><Button variant="outline" disabled={busy || !memory.can_edit} onClick={() => { setEditingMemory(memory.id); setMemoryText(memory.data.content ?? ""); setMemoryShared(memory.shared); }}>Corregir</Button><Button variant="ghost" disabled={busy || !memory.can_edit} onClick={() => void act(async () => { await api(`/memory/${memory.id}`, "DELETE"); await refresh(); })}><Trash2 />Olvidar</Button></div>)}
      </Card><Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Objetivos de la sucursal</h2><form className="space-y-3" onSubmit={event => { event.preventDefault(); void act(async () => { await api(editingGoal ? `/goals/${editingGoal}` : "/goals", editingGoal ? "PUT" : "POST", { title: goalTitle, metric: goalMetric, target: goalTarget, start_date: goalStart, end_date: goalEnd, shared: goalShared }); if (alive.current) { setGoalTitle(""); setGoalTarget(""); setEditingGoal(null); } await refresh(); }); }}>
        <label className="block text-sm">Nombre<input className={`${fieldClass} mt-2`} required maxLength={120} value={goalTitle} onChange={event => setGoalTitle(event.target.value)} /></label><label className="block text-sm">Medir<select className={`${fieldClass} mt-2`} value={goalMetric} onChange={event => setGoalMetric(event.target.value)}><option value="net_sales">Venta neta en MXN</option><option value="order_count">Tickets completados</option></select></label><label className="block text-sm">Meta<input className={`${fieldClass} mt-2`} required type="number" min="1" step={goalMetric === "order_count" ? "1" : "0.01"} value={goalTarget} onChange={event => setGoalTarget(event.target.value)} /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm">Desde<input type="date" className={`${fieldClass} mt-2`} required value={goalStart} onChange={event => setGoalStart(event.target.value)} /></label><label className="text-sm">Hasta<input type="date" className={`${fieldClass} mt-2`} required value={goalEnd} onChange={event => setGoalEnd(event.target.value)} /></label></div><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={goalShared} onChange={event => setGoalShared(event.target.checked)} />Compartir objetivo con administradores</label><Button type="submit" disabled={busy}>{editingGoal ? "Guardar corrección" : "Guardar objetivo"}</Button>
      </form>{goals.length === 0 ? <p className="text-sm text-kova-muted">Define una meta y revisaremos su avance con datos reales.</p> : goals.map(goal => <div key={goal.id} className="rounded-kova-md border border-kova-border p-3"><h3 className="font-medium">{goal.data.title}</h3><p className="text-sm text-kova-muted">{goal.data.current === undefined ? "Pendiente de medición" : `Avance: ${goal.data.current} de ${goal.data.target}`}{goal.data.achieved ? " · Meta alcanzada" : ""}</p><p className="text-xs text-kova-muted">{goal.data.start_date} a {goal.data.end_date}</p><Button variant="outline" disabled={busy || !goal.can_edit} onClick={() => { setEditingGoal(goal.id); setGoalTitle(goal.data.title ?? ""); setGoalMetric(goal.data.metric ?? "net_sales"); setGoalShared(goal.shared); setGoalTarget(goal.data.target ?? ""); setGoalStart(goal.data.start_date ?? ""); setGoalEnd(goal.data.end_date ?? ""); }}>Corregir</Button><Button variant="ghost" disabled={busy || !goal.can_edit} onClick={() => void act(async () => { await api(`/goals/${goal.id}`, "DELETE"); await refresh(); })}>Eliminar objetivo</Button></div>)}</Card></div> : null}
      {tab === "followup" ? <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Pendientes y seguimiento</h2><p className="text-sm text-kova-muted">Las señales se revisan con los datos del negocio. Marcar una tarea no cambia inventario, ventas o caja.</p>{tasks.length === 0 ? <p className="text-sm text-kova-muted">Todavía no hay señales verificadas para mostrar. Volveremos a revisar cuando cambien tus datos.</p> : tasks.map(task => <div key={task.id} className="rounded-kova-md border border-kova-border p-4"><h3 className="font-medium">{task.data.title}</h3><p className="mt-1 text-xs text-kova-muted">{statuses[task.status]} · Actualizado {new Date(task.updated_at).toLocaleString("es-MX")}</p><div className="mt-3 flex flex-wrap gap-2">{task.data.path ? <Link to={task.data.path} className="inline-flex min-h-11 items-center px-3 text-sm text-kova-blue underline">Abrir en Kova</Link> : null}{["reviewed", "postponed", "declared_completed"].map(status => <Button key={status} variant="outline" disabled={busy} onClick={() => void act(async () => { await api(`/tasks/${task.id}`, "PATCH", { status }); await refresh(); })}>{status === "reviewed" ? "Revisado" : status === "postponed" ? "Posponer" : "Ya lo hice"}</Button>)}</div></div>)}</Card> : null}
      {tab === "preferences" ? <Card className="space-y-5 p-5"><h2 className="text-lg font-semibold">Privacidad y avisos</h2><p className="text-sm text-kova-muted">Las consultas con IA usan {capabilities.provider_name ?? "un proveedor externo"}. Las búsquedas en documentos pueden usar Cloudflare para generar embeddings. Compartimos el contexto autorizado mínimo; cargar archivos requiere un permiso separado. Retirar un permiso detiene nuevos envíos.</p>{[["chat_consent", "Permitir consultas con IA externa"], ["document_consent", "Permitir procesamiento externo del texto de mis documentos"], ["email_opt_in", "Recibir por correo pendientes útiles del negocio"]].map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={Boolean(preferences[key as keyof Preferences])} disabled={key === "email_opt_in" && !capabilities.email} onChange={event => setPreferences(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}<label className="block text-sm">Frecuencia de correo<select className={`${fieldClass} mt-2 sm:max-w-xs`} value={preferences.frequency} onChange={event => setPreferences(current => ({ ...current, frequency: event.target.value as "daily" | "weekly" }))}><option value="weekly">Semanal, lunes a las 9:00</option><option value="daily">Diario a las 9:00, si hay novedades</option></select></label><p className="text-xs text-kova-muted">Horario del negocio. Máximo un correo por día; sin novedades útiles no enviamos.</p><Button disabled={busy} onClick={savePreferences}>Guardar preferencias</Button><a className="ml-3 inline-flex min-h-11 items-center text-sm text-kova-blue underline" href="/api/v1/assistant/export">Descargar mis datos del asistente</a></Card> : null}
      {proposals.length > 0 ? <Card className="space-y-3 p-5"><h2 className="font-semibold">Cambios propuestos</h2>{proposals.map(proposal => <div key={proposal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-kova-md border border-kova-border p-3"><p className="text-sm">{proposal.data.steps?.length} pasos · {statuses[proposal.status] ?? proposal.status}</p><Button variant="outline" onClick={() => { setSelectedProposal(proposal); setEditingProposal(false); }}>{proposal.status === "completed" ? "Ver comprobante" : "Revisar cambios"}</Button></div>)}</Card> : null}
      <Dialog open={selectedProposal !== null} onClose={() => { if (!busy) setSelectedProposal(null); }} className="sm:max-w-xl">
        <DialogTitle>{selectedProposal?.status === "completed" ? "Configuración guardada" : "Revisa antes de aplicar"}</DialogTitle><DialogDescription className="mt-2 mb-5">{tenantName} · Sucursal activa. Solo se aplicarán estos pasos; las ventas, caja y suscripción conservan sus flujos.</DialogDescription>
        {editingProposal && selectedProposal ? <ConfigurationDraft key={selectedProposal.id} initial={selectedProposal.data.steps} busy={busy} onCancel={() => setEditingProposal(false)} onPreview={steps => void act(async () => { const revised = await api<Resource>(`/proposals/${selectedProposal.id}/revise`, "POST", { steps }); if (alive.current) { setSelectedProposal(revised); setEditingProposal(false); } await refresh(); })} /> : <ChangeList steps={selectedProposal?.data.steps ?? []} />}{selectedProposal?.data.error ? <p role="alert" className="mt-4 text-sm text-kova-danger">{selectedProposal.data.error}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">{!editingProposal && selectedProposal && ["pending_approval", "partial", "approved"].includes(selectedProposal.status) ? <>{selectedProposal.status === "pending_approval" ? <Button variant="outline" disabled={busy} onClick={() => setEditingProposal(true)}>Corregir propuesta</Button> : null}<Button disabled={busy} onClick={confirm}>{busy ? "Aplicando…" : selectedProposal.status === "partial" ? "Confirmar pasos pendientes" : "Aplicar configuración"}</Button><Button variant="outline" disabled={busy} onClick={() => void act(async () => { await api(`/proposals/${selectedProposal.id}/reject`, "POST"); if (alive.current) setSelectedProposal(null); await refresh(); })}>Rechazar pendientes</Button></> : <Button variant="outline" onClick={() => setSelectedProposal(null)}>Cerrar</Button>}</div>
      </Dialog>
    </>}
  </main>;
}
