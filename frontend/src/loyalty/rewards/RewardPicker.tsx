import { useEffect, useState } from "react";
import type { WorkspaceIdentity } from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { moneyToCents } from "@/lib/money";
import { formatMoney } from "@/orders/format";
import { rewardRequest, type RewardOffer } from "./api";
export function RewardPicker({ identity, customerId, subtotal, online, manualDiscount, selected, onSelect }: {
  identity: WorkspaceIdentity; customerId: string; subtotal: number; online: boolean; manualDiscount: boolean;
  selected: boolean; onSelect: (offer: RewardOffer | null) => void;
}) {
  const { tenantId, userId, branchId } = identity;
  const [offer, setOffer] = useState<RewardOffer | null>(null);
  const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0); const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setOffer(null); setError(""); setConfirmed(false);
    if (!online) return;
    void rewardRequest<RewardOffer>({ tenantId, userId, branchId }, `/offer?customer_id=${encodeURIComponent(customerId)}`, "GET", undefined, undefined, controller.signal)
      .then(result => { if (active && result.customer_id === customerId) setOffer(result); })
      .catch(() => { if (active) setError("No pudimos consultar las recompensas de este cliente."); });
    return () => { active = false; controller.abort(); };
  }, [tenantId, userId, branchId, customerId, online, attempt]);
  if (!online) return <div className="space-y-2"><p className="text-xs text-kova-muted">Las recompensas se aplican con conexión. Puedes registrar una venta normal sin canje.</p>{selected && <Button type="button" variant="outline" onClick={() => onSelect(null)}>Quitar recompensa</Button>}</div>;
  if (error) return <div><p className="text-xs text-kova-muted">{error}</p><Button type="button" variant="link" onClick={() => setAttempt(value => value + 1)}>Consultar recompensas</Button></div>;
  const reward = offer?.reward;
  if (!offer || !reward?.enabled) return null;
  const eligible = !offer.adjustments_pending && offer.balance >= reward.points_cost && moneyToCents(reward.discount_amount) <= subtotal && !manualDiscount;
  return <section aria-label="Recompensa de esta venta" className="space-y-2 rounded-xl border border-kova-blue/20 bg-kova-mist p-3 text-sm">
    <p className="font-semibold">{reward.title}</p><p>{formatMoney(reward.discount_amount)} de descuento antes del impuesto adicional por {reward.points_cost.toLocaleString("es-MX")} puntos.</p>
    <p className="text-xs text-kova-muted">Saldo: {offer.balance.toLocaleString("es-MX")} puntos. El canje queda registrado al completar esta venta.</p>
    {offer.adjustments_pending ? <p role="status">Hay movimientos pendientes. Revisa los puntos antes de canjear.</p> : offer.balance < reward.points_cost ? <p>Faltan {(reward.points_cost - offer.balance).toLocaleString("es-MX")} puntos.</p> : moneyToCents(reward.discount_amount) > subtotal ? <p>El importe de la compra debe cubrir el descuento.</p> : manualDiscount ? <p>Quita el descuento manual para usar la recompensa.</p> : null}
    {selected ? <Button type="button" variant="outline" onClick={() => { onSelect(null); setConfirmed(false); }}>Quitar recompensa</Button> : <>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} disabled={!eligible} onChange={event => setConfirmed(event.target.checked)} />El cliente confirma usar sus puntos</label>
      <Button type="button" variant="outline" disabled={!eligible || !confirmed} onClick={() => onSelect(offer)}>Aplicar a esta venta</Button>
    </>}
  </section>;
}
