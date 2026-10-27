import { useEffect, useRef, useState } from "react";
import { ArrowRight, Gift } from "lucide-react";
import { resolveUserFacingError } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { clearMembershipKey, enrollMembership, loadMembership, memberCardPath, pendingMembershipKey, prepareMembershipKey, type Membership } from "./membership";

export function MembershipEntry(props: { menuToken: string; businessName: string; available?: boolean }) {
  return <MembershipEntryContent key={props.menuToken} {...props} />;
}
function MembershipEntryContent({ menuToken, businessName, available = true }: { menuToken: string; businessName: string; available?: boolean }) {
  const [open, setOpen] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [cardPath, setCardPath] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(() => Boolean(pendingMembershipKey(menuToken)));
  const operation = useRef<{ body: { menu_token: string; name: string; confirmed: true }; key: string } | null>(null);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError("");
    void loadMembership(menuToken, abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setMembership(value);
      if (value.card) { setCardPath(memberCardPath(value.card_path, menuToken)); clearMembershipKey(menuToken, pendingMembershipKey(menuToken)); setRecovering(false); }
    }).catch(failure => { if (!abort.signal.aborted) setError(resolveUserFacingError(failure, "No pudimos consultar el programa. Vuelve a intentar.")); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [menuToken, attempt]);
  const enroll = async () => {
    if (lock.current || !membership?.available || !membership.csrf_token || !name.trim() || !confirmed) return;
    if (!navigator.onLine) { setError("Conéctate a internet para crear tu tarjeta."); return; }
    if (!operation.current) {
      try { operation.current = { body: { menu_token: menuToken, name: name.trim(), confirmed: true }, key: prepareMembershipKey(menuToken) }; }
      catch (failure) { setError(resolveUserFacingError(failure, "No pudimos guardar tu solicitud. Consulta con el equipo antes de crear otra tarjeta.")); return; }
    }
    lock.current = true; setBusy(true); setError(""); controller.current = new AbortController();
    try {
      const saved = await enrollMembership(operation.current.body, membership.csrf_token, operation.current.key, controller.current.signal);
      const context = await loadMembership(menuToken, controller.current.signal);
      if (!controller.current.signal.aborted) {
        const safePath = memberCardPath(saved.card_path, menuToken);
        if (!safePath || !context.card || context.card.member_code !== saved.card.member_code) throw new Error("No pudimos confirmar el acceso a tu tarjeta en este navegador. Consulta tu tarjeta de nuevo antes de continuar.");
        clearMembershipKey(menuToken, operation.current.key); setRecovering(false);
        setCardPath(safePath);
      }
    } catch (failure) { if (!controller.current.signal.aborted) setError(resolveUserFacingError(failure, "No pudimos confirmar el alta. Consulta tu tarjeta antes de intentar de nuevo.")); }
    finally { lock.current = false; if (!controller.current.signal.aborted) setBusy(false); }
  };
  if (!open && ((!membership && (loading || (!available && !recovering))) || (membership && !membership.available && !membership.card && !operation.current && !recovering))) return null;
  return <>
    <button type="button" aria-label={cardPath ? "Ver mi tarjeta" : "Tu tarjeta de lealtad"} onClick={() => setOpen(true)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-kova-border bg-white px-4 py-3 text-left text-kova-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-kova-blue/10 text-kova-blue"><Gift className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{cardPath ? "Ver mi tarjeta" : "Tu tarjeta de lealtad"}</span><span className="mt-0.5 block text-xs text-kova-muted">{cardPath ? "Consulta tus puntos y recompensas." : "Consulta el programa y guarda tu tarjeta."}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
    <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }}>
      <DialogTitle className="break-words pr-8 leading-tight">Tu tarjeta en {membership?.business_name ?? businessName}</DialogTitle>
      {loading ? <p role="status" className="mt-4 text-sm text-kova-muted">Consultando tu tarjeta…</p> : cardPath ? <div className="mt-5 space-y-4">
        <p className="text-sm">Tu tarjeta está lista en este navegador. Muéstrala al equipo cuando compres.</p>
        <a href={cardPath} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center rounded-xl bg-kova-blue px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue">Ver mi tarjeta<span className="sr-only"> (abre en otra pestaña)</span></a>
        <p className="text-xs text-kova-muted">Se abre en otra pestaña para que puedas seguir con tu pedido aquí.</p>
      </div> : membership?.available && membership.csrf_token ? <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void enroll(); }}>
        <p className="text-sm leading-relaxed text-kova-muted">Crea una tarjeta personal nueva para registrar los puntos de tus próximas compras. No necesitas teléfono ni correo.</p>
        {recovering && <p role="status" className="rounded-xl bg-kova-mist p-3 text-xs">Tienes un alta pendiente de confirmar. Usa el mismo nombre o alias para reintentar sin crear otra tarjeta, o consulta tu tarjeta de nuevo.</p>}
        {membership.policy.enabled && membership.policy.spend_amount && membership.policy.points_per_step != null && <p className="text-xs leading-relaxed text-kova-muted">En cada compra elegible, acumulas {membership.policy.points_per_step.toLocaleString("es-MX")} puntos por cada tramo completo de {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(membership.policy.spend_amount))} MXN. Los importes sobrantes no se suman entre compras.</p>}
        {membership.reward?.enabled ? <div className="rounded-xl bg-kova-mist p-3 text-sm"><p className="font-medium">{membership.reward.title}</p><p className="mt-1 text-xs">{membership.reward.points_cost.toLocaleString("es-MX")} puntos por {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(membership.reward.discount_amount))} MXN de descuento. Se confirma con el equipo al comprar.</p></div> : <p className="text-xs text-kova-muted">Consulta tus beneficios con el equipo.</p>}
        <div><label htmlFor="membership-name" className="mb-1.5 block text-sm font-medium">¿Cómo te llamamos?</label><Input id="membership-name" name="membership-name" autoComplete="nickname" value={name} maxLength={80} required disabled={busy || Boolean(operation.current)} onChange={event => setName(event.target.value)} /><p className="mt-1.5 text-xs text-kova-muted">Puedes usar un nombre corto o alias para que el equipo te identifique.</p></div>
        <p className="text-xs leading-relaxed text-kova-muted">Tu tarjeta queda guardada en este navegador. Si borras sus datos o cambias de dispositivo, puedes perder el acceso; pide ayuda al equipo para que te comparta un enlace. No se recuperan saldos de tarjetas anteriores por nombre o teléfono.</p>
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={confirmed} disabled={busy || Boolean(operation.current)} onChange={event => setConfirmed(event.target.checked)} />Quiero crear mi tarjeta personal en este dispositivo.</label>
        <Button type="submit" className="min-h-12 w-full" disabled={busy || !name.trim() || !confirmed}>{busy ? "Creando tu tarjeta…" : operation.current ? "Reintentar crear mi tarjeta" : "Crear mi tarjeta"}</Button>
      </form> : !error && <p className="mt-4 text-sm text-kova-muted">El negocio no tiene disponibles nuevas tarjetas en este momento. Consulta al equipo.</p>}
      {error && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive-strong">{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Consultar mi tarjeta de nuevo</Button></div>}
    </Dialog>
  </>;
}
