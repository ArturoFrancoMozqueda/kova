import { useEffect, useId, useRef, useState } from "react";
import { ContactRound, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { csrfHeaders } from "@/lib/csrf";
import type { WorkspaceIdentity } from "@/automations/workspace";

type MemberCustomer = { id: string; name: string; is_active: boolean };
type Props = { identity: WorkspaceIdentity; disabled: boolean; online: boolean; onSelect: (customer: MemberCustomer) => void };

export function MemberLookup(props: Props) {
  const { tenantId, userId, branchId } = props.identity;
  return <MemberLookupSession key={`${tenantId}:${userId}:${branchId}`} {...props} />;
}

function MemberLookupSession({ identity, disabled, online, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<MemberCustomer | null>(null);
  const [error, setError] = useState("");
  const inputId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const blocked = disabled || !online;

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!blocked) return;
    requestRef.current?.abort();
    setBusy(false);
    setCandidate(null);
  }, [blocked]);
  useEffect(() => { if (expanded) inputRef.current?.focus(); }, [expanded]);
  useEffect(() => { if (candidate) confirmRef.current?.focus(); }, [candidate]);

  function close() {
    requestRef.current?.abort();
    setExpanded(false); setCode(""); setCandidate(null); setError(""); setBusy(false);
    openerRef.current?.focus();
  }

  async function lookup() {
    if (blocked || busy || !code.trim()) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setCandidate(null); setError("");
    try {
      const response = await fetch("/api/v1/loyalty/members/resolve", {
        method: "POST", credentials: "include", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...csrfHeaders("POST"),
          "X-Kova-Expected-Tenant": identity.tenantId, "X-Kova-Expected-User": identity.userId, "X-Kova-Branch": identity.branchId },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError(response.status === 404 ? "No encontramos una tarjeta activa con ese código en este negocio. Revisa el código que muestra el cliente."
          : response.status === 429 ? "Espera un momento antes de buscar otra tarjeta."
            : "No pudimos consultar la tarjeta. Revisa tu conexión y tus permisos e inténtalo de nuevo.");
        return;
      }
      const payload = await response.json() as { customer?: Partial<MemberCustomer> };
      if (controller.signal.aborted) return;
      const customer = payload.customer;
      if (!customer || typeof customer.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customer.id)
        || typeof customer.name !== "string" || !customer.name.trim() || customer.is_active !== true) {
        setError("Esta tarjeta no está disponible para una nueva venta."); return;
      }
      setCandidate(customer as MemberCustomer);
    } catch {
      if (!controller.signal.aborted) setError("No pudimos consultar la tarjeta. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section aria-label="Identificar tarjeta de lealtad" className="space-y-3">
    <Button ref={openerRef} type="button" variant="outline" className="w-full whitespace-normal" disabled={blocked} aria-expanded={expanded}
      onClick={() => expanded ? close() : setExpanded(true)}><ContactRound aria-hidden="true" />Identificar tarjeta</Button>
    {!online && <p className="text-xs text-kova-muted">Conéctate para identificar una tarjeta de lealtad.</p>}
    {expanded && <div className="space-y-3 rounded-xl border border-kova-border bg-kova-mist p-3" aria-busy={busy}>
      <div className="flex items-center justify-between gap-2"><Label htmlFor={inputId}>Número de tarjeta</Label>
        <Button type="button" variant="ghost" size="icon" aria-label="Cerrar búsqueda de tarjeta" disabled={disabled} onClick={close}><X aria-hidden="true" /></Button></div>
      <p id={`${inputId}-help`} className="text-xs text-kova-muted">Escribe o pega el código que aparece en la tarjeta del cliente.</p>
      <Input ref={inputRef} id={inputId} value={code} maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false}
        placeholder="KV-XXXX-XXXX-XXXX-XXXX" aria-describedby={`${inputId}-help`} disabled={blocked || busy}
        onChange={event => { requestRef.current?.abort(); setCode(event.target.value); setCandidate(null); setError(""); setBusy(false); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void lookup(); } }} />
      <Button type="button" variant="secondary" className="w-full" disabled={blocked || busy || !code.trim()} onClick={() => void lookup()}><Search aria-hidden="true" />{busy ? "Buscando tarjeta…" : "Buscar tarjeta"}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {candidate && <div className="space-y-2 border-t border-kova-border pt-3"><p className="break-words text-sm">Tarjeta de <strong>{candidate.name}</strong></p>
        <p className="text-xs text-kova-muted">Confirma que corresponde al cliente que vas a cobrar.</p>
        <Button ref={confirmRef} type="button" className="w-full" disabled={blocked || busy} onClick={() => { if (blocked || busy) return; onSelect(candidate); close(); }}>Usar cliente</Button></div>}
    </div>}
  </section>;
}
