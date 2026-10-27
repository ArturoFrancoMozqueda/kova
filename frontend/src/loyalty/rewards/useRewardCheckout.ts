import { useEffect, useRef, useState } from "react";
import type { WorkspaceIdentity } from "@/automations/workspace";
import type { Order } from "@/orders/types";
import { resolveUserFacingError } from "@/lib/apiError";
import { checkoutReward, RewardError, type RewardCheckout } from "./api";
import { forgetReward, readPendingReward, rememberReward, rewardScope, type PendingReward } from "./pending";
export function useRewardCheckout(identity: WorkspaceIdentity, onComplete: (order: Order) => void, onRejected: () => void) {
  const { tenantId, userId, branchId } = identity;
  const [pending, setPending] = useState<PendingReward | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = rewardScope(identity);
  const current = useRef(scope); current.current = scope;
  const lock = useRef(false);
  const preparing = useRef(false);
  const callbacks = useRef({ onComplete, onRejected }); callbacks.current = { onComplete, onRejected };
  useEffect(() => {
    current.current = scope;
    let active = true; setReady(false); setPending(null); setError("");
    void readPendingReward({ tenantId, userId, branchId }).then(record => { if (active) { setPending(record ?? null); setReady(true); } })
      .catch(() => { if (active) setError("No pudimos consultar las ventas pendientes de este dispositivo. Recarga antes de cobrar."); });
    return () => { active = false; if (current.current === scope) current.current = ""; };
  }, [tenantId, userId, branchId, scope]); // each principal owns its recovery record
  const execute = async (record: PendingReward) => {
    if (lock.current || current.current !== record.scope || !navigator.onLine) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const order = await checkoutReward(identity, record.body, record.key);
      if (!order || typeof order.id !== "string" || order.status !== "completed" || order.tenant_id !== identity.tenantId || (order.branch_id && order.branch_id !== identity.branchId) || order.customer_id !== record.body.order.customer_id || !Array.isArray(order.items) || !Array.isArray(order.payments)) {
        throw new Error("La respuesta no confirma esta venta. Conservamos su referencia para consultar el resultado.");
      }
      await forgetReward(record);
      if (current.current === record.scope) { setPending(null); callbacks.current.onComplete(order); }
    } catch (failure) {
      if (failure instanceof RewardError && [400, 409, 422].includes(failure.status)) {
        try {
          await forgetReward(record);
          if (current.current === record.scope) { setPending(null); callbacks.current.onRejected(); }
        } catch { /* Keep the persisted reference until local storage can confirm removal. */ }
      }
      if (current.current === record.scope) {
        const message = resolveUserFacingError(failure, "No pudimos confirmar la venta.");
        setError(failure instanceof RewardError && [400, 409, 422].includes(failure.status) ? message : `${message} Consulta el resultado sin volver a cobrar.`);
      }
    } finally {
      lock.current = false;
      if (current.current === record.scope) setBusy(false);
    }
  };
  const submit = async (body: RewardCheckout) => {
    if (!ready || pending || lock.current || preparing.current || !navigator.onLine) return;
    preparing.current = true;
    try {
      const record = await rememberReward(identity, body);
      if (current.current !== record.scope) return;
      setPending(record); await execute(record);
    } catch (failure) {
      setError(resolveUserFacingError(failure, "No pudimos preparar la venta en este dispositivo. Revisa el almacenamiento del navegador antes de intentar de nuevo."));
      try { setPending((await readPendingReward(identity)) ?? null); } catch { /* No request was sent without a durable reference. */ }
    } finally { preparing.current = false; }
  };
  return { pending, ready, busy, error, submit, retry: () => pending ? execute(pending) : Promise.resolve() };
}
