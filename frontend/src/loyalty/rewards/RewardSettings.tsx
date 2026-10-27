import { useEffect, useRef, useState } from "react";
import type { WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/orders/format";
import { resolveUserFacingError } from "@/lib/apiError";
import { isReward, rewardRequest, type Reward } from "./api";
export function RewardSettings({ identity }: { identity: WorkspaceIdentity }) {
  const { tenantId, userId, branchId } = identity;
  const [reward, setReward] = useState<Reward | null>(null);
  const [loaded, setLoaded] = useState(false); const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false); const [title, setTitle] = useState("");
  const [cost, setCost] = useState(""); const [amount, setAmount] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false); const lock = useRef(false); const requestKey = useRef({ signature: "", key: "" });
  useEffect(() => {
    alive.current = true; let active = true; const controller = new AbortController();
    void rewardRequest<Reward | null>({ tenantId, userId, branchId }, "", "GET", undefined, undefined, controller.signal).then(value => {
      if (value !== null && !isReward(value)) throw new Error("Respuesta de recompensa inválida");
      if (!active) return;
      setReward(value); setTitle(value?.title ?? ""); setCost(value ? String(value.points_cost) : "");
      setAmount(value?.discount_amount ?? ""); setEnabled(value?.enabled ?? false); setLoaded(true);
    }).catch(() => { if (active) setError("No pudimos consultar la recompensa de esta sucursal."); });
    return () => { active = false; alive.current = false; controller.abort(); };
  }, [tenantId, userId, branchId, attempt]);
  const save = async () => {
    if (lock.current || !loaded || !navigator.onLine) return;
    const body = { expected_version: reward?.version ?? 0, enabled, title: title.trim(), points_cost: Number(cost), discount_amount: amount };
    const signature = JSON.stringify(body);
    if (requestKey.current.signature !== signature) requestKey.current = { signature, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const saved = await rewardRequest<Reward>(identity, "", "PUT", body, requestKey.current.key);
      if (alive.current) { setReward(saved); setOpen(false); setNotice("Recompensa guardada. Se aplicará únicamente a los nuevos canjes confirmados en caja."); requestKey.current.signature = ""; }
    } catch (failure) { if (alive.current) setError(`${resolveUserFacingError(failure, "No pudimos confirmar si se guardó la recompensa.")} Consulta la recompensa actual antes de volver a guardar.`); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <section aria-label="Recompensa en caja" className="space-y-4 rounded-2xl border border-kova-border bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Una razón para volver</h2><p className="mt-1 text-sm text-kova-muted">Define qué obtiene tu cliente con sus puntos.</p></div><Button type="button" variant="outline" disabled={!loaded || busy} onClick={() => setOpen(value => !value)}>{open ? "Cerrar configuración" : reward ? "Editar recompensa" : "Definir recompensa"}</Button></div>
    {reward ? <div><p className="font-medium">{reward.title} · {reward.enabled ? "Activa" : "Pausada"}</p><p className="mt-1 text-sm">{reward.points_cost.toLocaleString("es-MX")} puntos por {formatMoney(reward.discount_amount)} de descuento en una compra.</p></div> : loaded && <p className="text-sm text-kova-muted">Todavía no has definido un beneficio. Los puntos existentes se conservan.</p>}
    {open && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
      <div className="sm:col-span-2"><Label htmlFor="reward-title">Nombre de la recompensa</Label><Input id="reward-title" value={title} maxLength={160} required onChange={event => setTitle(event.target.value)} /></div>
      <div><Label htmlFor="reward-points">Puntos para canjear</Label><Input id="reward-points" type="number" min="1" step="1" value={cost} required onChange={event => setCost(event.target.value)} /></div>
      <div><Label htmlFor="reward-discount">Descuento en MXN</Label><Input id="reward-discount" inputMode="decimal" value={amount} required onChange={event => setAmount(event.target.value)} /></div>
      <label className="flex min-h-11 items-center gap-2 sm:col-span-2"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Permitir nuevos canjes en caja</label>
      <p className="text-xs text-kova-muted sm:col-span-2">Se confirma al completar la venta en línea. El descuento se aplica antes del impuesto adicional, no se combina con otro descuento y la compra debe cubrir el importe del beneficio.</p><Button type="submit" className="justify-self-start">{busy ? "Guardando…" : "Guardar recompensa"}</Button>
    </fieldset></form>}
    {error && <div><p role="alert" className="text-sm text-destructive-strong">{error}</p><Button type="button" variant="link" disabled={busy} onClick={() => { setError(""); setLoaded(false); setAttempt(value => value + 1); }}>Consultar recompensa actual</Button></div>}{notice && <p role="status" className="text-sm text-kova-growth-strong">{notice}</p>}
  </section>;
}
