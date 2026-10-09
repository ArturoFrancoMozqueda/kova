import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, BarChart3, Check, Copy, FileText, Loader2, Package, ShieldCheck, Sparkles } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Resource, Usage } from "./api";
import { EvidenceCards, SalesEvidence } from "./EvidenceCards";

// The companion is present throughout the app; load the Markdown parser only
// when an actual assistant response is displayed.
const AnswerContent = lazy(() => import("./AnswerContent"));
const suggestions = [
  { title: "Entender mis ventas", question: "Revisa mis ventas de este mes", icon: BarChart3 },
  { title: "Revisar mi inventario", question: "¿Qué productos necesitan mi atención?", icon: Package },
  { title: "Preparar mi negocio", question: "Ayúdame a configurar mi negocio", icon: ShieldCheck },
  { title: "Organizar mis pendientes", question: "¿Qué pendientes tengo?", icon: Check },
];

const localSuggestions = [
  suggestions[0],
  { title: "Revisar mi inventario", question: "¿Qué productos debo reponer?", icon: Package },
  { title: "Preparar mi ticket", question: "¿Dónde configuro el ticket?", icon: ShieldCheck },
  { title: "Importar mi catálogo", question: "¿Cómo importar mi catálogo?", icon: Check },
];

export function AssistantWelcome({ onSuggestion, disabled, compact = false, suggestion, localOnly = false }: { onSuggestion: (question: string) => void; disabled: boolean; compact?: boolean; suggestion?: string; localOnly?: boolean }) {
  const availableSuggestions = localOnly ? localSuggestions : suggestions;
  return <div className={cn("mx-auto flex w-full max-w-xl flex-col items-center text-center", compact ? "py-5" : "py-3 sm:py-12")}>
    <div className={cn("mb-5 items-center justify-center rounded-2xl border border-kova-blue/10 bg-kova-grad-sky text-kova-blue", compact ? "flex h-12 w-12" : "hidden h-16 w-16 sm:flex")}><LogoMark size={compact ? 32 : 42} /></div>
    <p className={cn("mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-kova-muted", !compact && "hidden sm:block")}>Un poco más de claridad</p>
    <h2 className={cn("font-semibold tracking-tight text-kova-ink", compact ? "text-xl" : "text-2xl sm:text-3xl")}>¿Qué quieres resolver hoy?</h2>
    <p className="mt-3 max-w-sm text-sm leading-6 text-kova-muted">Tus ventas, tus productos y tu siguiente paso. Con los datos de tu negocio.</p>
    {compact ? <button type="button" disabled={disabled} onClick={() => onSuggestion(suggestion ?? suggestions[0].question)} className="mt-5 flex min-h-11 w-full items-center justify-between gap-3 rounded-kova-lg border border-kova-border bg-white p-3 text-left text-sm text-kova-ink transition-colors hover:border-kova-blue/40 hover:bg-kova-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue disabled:opacity-50">{suggestion ?? suggestions[0].question}<ArrowUpRight size={16} className="shrink-0 text-kova-blue" /></button>
      : <div className="mt-7 grid w-full gap-2 text-left sm:grid-cols-2">{availableSuggestions.map(({ title, question, icon: Icon }) => <button type="button" key={title} aria-label={question} disabled={disabled} onClick={() => onSuggestion(question)} className="group flex min-h-11 items-start gap-3 rounded-kova-lg text-left border border-kova-border bg-white p-4 transition-colors hover:border-kova-blue/40 hover:bg-kova-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue disabled:opacity-50"><Icon size={18} className="mt-0.5 shrink-0 text-kova-blue" /><span className="min-w-0"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-kova-muted">{question}</span></span><ArrowUpRight size={14} className="ml-auto mt-1 shrink-0 text-kova-muted" /></button>)}</div>}
  </div>;
}

function AnswerEvidence({ data, compact }: { data: Resource["data"]; compact: boolean }) {
  return <div className="space-y-3">
    {data.metrics ? <SalesEvidence metrics={data.metrics} compact={compact} /> : null}
    {data.cards ? <EvidenceCards cards={data.cards} /> : null}
    {data.sources?.length ? <details className="rounded-kova-lg border border-kova-border bg-kova-mist/40 px-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium focus-visible:outline-kova-blue">Fuentes consultadas · {data.sources.length}</summary><div className="space-y-1 border-t border-kova-border py-2">{data.sources.map((source, index) => <a key={`${source.id}:${index}`} href={source.path} className="flex min-h-11 items-center gap-2 rounded-kova-md p-2 text-sm text-kova-blue hover:bg-white focus-visible:outline-kova-blue"><FileText size={16} className="shrink-0" /><span className="min-w-0 break-words">{source.title} · Página {source.page}</span><ArrowUpRight size={14} className="ml-auto shrink-0" /></a>)}</div></details> : null}
  </div>;
}

function Message({ message, compact }: { message: Resource; compact: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timeout.current); }; }, []);
  const user = message.data.role === "user";
  const content = message.data.content ?? "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); if (mounted.current) setCopyState("copied"); }
    catch { if (mounted.current) setCopyState("failed"); }
    if (mounted.current) { clearTimeout(timeout.current); timeout.current = setTimeout(() => setCopyState("idle"), 2500); }
  };
  if (user) return <article className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-kova-mist px-4 py-3"><p className="sr-only">Tú</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{content}</p></article>;
  return <article data-assistant-message className="min-w-0">
    <div className="mb-3 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-kova-blue/10 text-kova-blue"><LogoMark size={20} /></span><p className="text-xs font-semibold">Asistente Kova</p></div>
    <Suspense fallback={<p className="whitespace-pre-wrap break-words text-sm leading-7">{content}</p>}><AnswerContent content={content} /></Suspense>
    <div className="mt-2 flex items-center gap-2"><Button variant="ghost" className="px-2 text-xs text-kova-muted" aria-label={copyState === "copied" ? "Respuesta copiada" : "Copiar respuesta"} onClick={() => void copy()}>{copyState === "copied" ? <Check /> : <Copy />}{copyState === "copied" ? "Copiada" : "Copiar"}</Button><span role="status" className="text-xs text-kova-muted">{copyState === "failed" ? "No pudimos copiar. Selecciona el texto para copiarlo." : copyState === "copied" ? "Respuesta copiada" : ""}</span></div>
    <AnswerEvidence data={message.data} compact={compact} />
  </article>;
}

export function AssistantConversation({ messages, run, busy, onCancel, empty, compact = false, children }: { messages: Resource[]; run: Resource | null; busy: boolean; onCancel: () => void; empty: ReactNode; compact?: boolean; children?: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastUser = useRef<string>();
  const lastAnswer = useRef<string>();
  const [showLatest, setShowLatest] = useState(false);
  const generating = !!run && ["queued", "running"].includes(run.status);
  const lastMessage = messages[messages.length - 1];
  const latestUser = messages.filter(message => message.data.role === "user").at(-1)?.id;
  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    if (messages.length === 0) {
      container.scrollTop = 0; nearBottom.current = true; setShowLatest(false);
      lastUser.current = undefined; lastAnswer.current = undefined;
      return;
    }
    if (nearBottom.current || latestUser !== lastUser.current) {
      const answers = container.querySelectorAll<HTMLElement>("[data-assistant-message]");
      const answer = answers.item(answers.length - 1);
      // A completed response may be taller than the viewport. Start at its
      // explanation instead of skipping straight to the last evidence card.
      if (lastMessage?.data.role === "assistant" && answer) {
        if (lastMessage.id !== lastAnswer.current) {
          container.scrollTop += answer.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
          lastAnswer.current = lastMessage.id;
        }
      } else { container.scrollTop = container.scrollHeight; }
      nearBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      setShowLatest(!nearBottom.current);
    } else { setShowLatest(true); }
    lastUser.current = latestUser;
  }, [messages.length, lastMessage?.id, lastMessage?.data.role, latestUser, run?.status, run?.id]);
  return <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scroll} role="log" aria-label={compact ? "Conversación del asistente" : "Conversación privada"} aria-live="polite" aria-relevant="additions" onScroll={() => {
      const container = scroll.current;
      if (!container) return;
      nearBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      setShowLatest(!nearBottom.current);
    }} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", compact ? "px-4 py-4" : "px-4 py-5 sm:px-8")}>
      <div className="mx-auto max-w-2xl space-y-6">
        {messages.length === 0 ? empty : messages.map(message => <Message key={message.id} message={message} compact={compact} />)}
        {run && !generating ? <div className="space-y-3">
          {run.data.error ? <p role="alert" className="rounded-kova-md bg-kova-danger/5 p-3 text-sm text-kova-danger">{run.data.error}</p> : null}
          {!messages.some(message => message.data.run_id === run.id) ? <AnswerEvidence data={run.data} compact={compact} /> : null}
        </div> : null}
        {generating ? <div role="status" className="flex items-center gap-3 rounded-kova-lg bg-kova-mist/60 px-3 py-2"><Loader2 size={16} className="shrink-0 animate-spin text-kova-blue motion-reduce:animate-none" /><p className="flex-1 text-sm text-kova-muted">{run?.status === "queued" ? "Preparando tu consulta…" : "Consultando los datos de tu negocio…"}</p><Button variant="ghost" disabled={busy} className="px-2 text-xs" onClick={onCancel}>Cancelar</Button></div> : null}
        {run?.status === "failed" && run.data.limit_kind && run.data.retry_at ? <p role="status" className="rounded-kova-lg bg-kova-mist p-3 text-xs leading-5 text-kova-muted">Puedes volver a consultar con IA después de {new Date(run.data.retry_at).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}. Mientras tanto, pregunta cuánto vendiste hoy, qué productos se venden más o cómo importar tu catálogo.</p> : null}
        {children}
      </div>
    </div>
    {showLatest ? <Button variant="outline" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-kova-card-hover" onClick={() => { const container = scroll.current; if (container) container.scrollTop = container.scrollHeight; nearBottom.current = true; setShowLatest(false); }}><ArrowDown />Ir al último mensaje</Button> : null}
  </div>;
}

export function AssistantComposer({ id, value, onChange, onSubmit, disabled, ready, compact = false }: { id: string; value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; disabled: boolean; ready: boolean; compact?: boolean }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, compact ? 120 : 176)}px`;
  }, [value, compact]);
  return <form onSubmit={event => { if (!disabled && ready && value.trim()) onSubmit(event); else event.preventDefault(); }} className={cn("shrink-0 border-t border-kova-border bg-white", compact ? "p-3" : "px-4 py-4 sm:px-8")}>
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-kova-border bg-white p-3 shadow-kova-card transition-shadow focus-within:border-kova-blue/50 focus-within:ring-2 focus-within:ring-kova-blue/10">
        <label htmlFor={id} className="sr-only">Tu pregunta</label>
        <textarea ref={textarea} id={id} rows={compact ? 1 : 2} maxLength={4000} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!disabled && ready && value.trim()) event.currentTarget.form?.requestSubmit(); }
        }} placeholder="Cuéntame qué necesitas resolver…" className="block min-h-11 w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-kova-ink placeholder:text-kova-muted focus:ring-0 focus-visible:outline-none disabled:opacity-50" />
        <div className="mt-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[11px] text-kova-muted"><Sparkles size={13} className="shrink-0" />{compact ? "Con tus datos reales" : "Tus datos, una conversación más clara"}</span><Button type="submit" size={compact ? "icon" : "default"} aria-label={compact ? "Enviar pregunta" : "Consultar"} disabled={disabled || !value.trim() || !ready} className="shrink-0 rounded-lg bg-kova-blue hover:bg-kova-blue/90"><ArrowUp size={16} />{compact ? null : "Consultar"}</Button></div>
      </div>
      {!compact ? <p className="mt-2 text-center text-[11px] leading-5 text-kova-muted"><span className="hidden sm:inline">Enter para enviar · Shift + Enter para otra línea. </span>Los cambios requieren tu confirmación.</p> : null}
    </div>
  </form>;
}

export function AssistantUsage({ usage }: { usage: Usage }) {
  const percent = usage.tenant_limit > 0 ? Math.min(100, Math.max(0, usage.tenant_used / usage.tenant_limit * 100)) : 0;
  const paused = usage.limit_kind && usage.limit_kind !== "available";
  const label = usage.limit_kind === "temporary" ? "La IA tiene una pausa temporal" : usage.limit_kind === "provider_monthly" ? "La capacidad mensual compartida de IA se agotó" : usage.limit_kind === "provider_daily" ? "La capacidad compartida de IA se agotó" : "Tu negocio alcanzó su cuota de IA";
  const recovery = new Date(usage.retry_at ?? usage.reset_at).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const dailyReset = new Date(usage.reset_at).toLocaleString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return <details className="max-w-full rounded-kova-lg border border-kova-border bg-white px-3 text-xs text-kova-muted">
    <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-kova-blue">{paused ? label : `Uso del asistente · ${Math.round(percent)}% de la cuota diaria`}</summary>
    <div className="max-w-xs space-y-2 border-t border-kova-border pb-3 pt-2"><p>Cuota diaria compartida: {usage.tenant_used.toLocaleString("es-MX")} / {usage.tenant_limit.toLocaleString("es-MX")} {usage.unit === "tokens" ? "tokens" : usage.unit === "neurons" ? "neuronas" : "unidades"}</p><div className="h-1.5 overflow-hidden rounded-full bg-kova-mist"><div className="h-full rounded-full bg-kova-blue" style={{ width: `${percent}%` }} /></div><p className="leading-5">Incluye consumo estimado y reservas pendientes · {usage.window === "rolling_24h" ? "Se libera gradualmente; próxima recuperación" : "Se renueva"} {dailyReset}</p>{paused ? <p className="leading-5">Próxima recuperación de IA: {recovery}</p> : null}<p className="leading-5">La ayuda y los reportes directos siguen disponibles.</p></div>
  </details>;
}
