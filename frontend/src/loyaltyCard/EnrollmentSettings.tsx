import { resolveUserFacingError } from "@/lib/apiError";
import { useEffect, useRef, useState } from "react";
import { useOperationsRequest, type WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
type Policy = { enabled: boolean; version: number };
export function EnrollmentSettings({ identity }: { identity: WorkspaceIdentity }) {
  const request = useOperationsRequest("/api/v1/loyalty/enrollment-policy", identity);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false);
  const locked = useRef(false);
  const operation = useRef({ signature: "", key: "" });
  useEffect(() => {
    let active = true; alive.current = true; setPolicy(null); setError("");
    void request<Policy>().then(value => {
      if (typeof value.enabled !== "boolean" || !Number.isInteger(value.version)) throw new Error("Invalid policy");
      if (active) { setPolicy(value); setEnabled(value.enabled); }
    }).catch(() => { if (active) setError("No pudimos consultar el acceso a tarjetas desde el menú."); });
    return () => { active = false; alive.current = false; };
  }, [request, attempt]);
  const save = async () => {
    if (locked.current || !policy || !navigator.onLine) return;
    const body = { enabled, expected_version: policy.version }; const signature = JSON.stringify(body);
    if (operation.current.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const value = await request<Policy>("", "PUT", body, operation.current.key);
      if (alive.current) { setPolicy(value); setEnabled(value.enabled); setOpen(false); operation.current.signature = ""; setNotice("Acceso a tarjetas guardado. Las tarjetas existentes conservan sus puntos."); }
    } catch (failure) { if (alive.current) setError(resolveUserFacingError(failure, "No pudimos guardar el acceso a tarjetas.")); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  return <section aria-label="Tarjetas desde el menú" className="space-y-4 rounded-2xl border border-kova-border bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Tu lealtad, desde el menú</h2><p className="mt-1 text-sm text-kova-muted">Tus clientes pueden obtener una tarjeta personal sin dar su teléfono ni correo.</p></div><Button type="button" variant="outline" disabled={!policy || busy} onClick={() => setOpen(value => !value)}>{open ? "Cerrar acceso a tarjetas" : "Configurar tarjetas"}</Button></div>
    {policy && <p className="text-sm">{policy.enabled ? "Permites nuevas tarjetas desde el menú publicado cuando la regla de puntos está activa." : "Las nuevas tarjetas desde el menú están desactivadas."}</p>}
    {open && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} />Permitir nuevas tarjetas desde el menú</label>
      <p className="text-xs leading-relaxed text-kova-muted">Es independiente de la regla de acumulación. No crea puntos ni recupera clientes anteriores por nombre o teléfono. Al pausarlo, las tarjetas ya emitidas siguen disponibles.</p>
      <Button type="submit" disabled={busy || !navigator.onLine}>{busy ? "Guardando…" : "Guardar acceso a tarjetas"}</Button>
    </form>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive-strong">{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); setAttempt(value => value + 1); }}>Consultar acceso actual a tarjetas</Button></div>}
    {notice && <p role="status" className="text-sm text-kova-growth-strong">{notice}</p>}
  </section>;
}
