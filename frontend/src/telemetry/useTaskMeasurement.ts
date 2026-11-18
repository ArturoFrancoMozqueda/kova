import { useEffect, useMemo } from "react";
import { trackFunnelEvent, type FunnelDeliveryGuard } from "./funnel";

export type MeasuredTask = "cash_sale" | "customer_order" | "purchase_receipt" | "replenishment_purchase" | "automation_task";
export type TaskOutcome = "completed" | "failed" | "cancelled" | "queued";
export type TaskMeasurement = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  finish: (outcome: TaskOutcome) => void;
  discard: () => void;
};
const MAX_DURATION = 86_400_000;

/** One anonymous attempt identity, never a customer/order/session identifier.
 * Active time excludes hidden tabs and explicit waits; elapsed time uses a
 * monotonic clock, so offline delivery and clock changes cannot inflate it.
 */
export function createTaskMeasurement(task: MeasuredTask, owner: FunnelDeliveryGuard | null): TaskMeasurement {
  if (typeof document === "undefined") {
    const noop = () => {};
    return { start: noop, pause: noop, resume: noop, finish: noop, discard: noop };
  }
  let attempt: { id: string; started: number; checkpoint: number; active: number; paused: boolean; offline: boolean } | null = null;
  const checkpoint = () => {
    if (!attempt) return;
    const now = performance.now();
    if (!attempt.paused && document.visibilityState !== "hidden") attempt.active += Math.max(0, now - attempt.checkpoint);
    attempt.checkpoint = now;
  };
  // visibilitychange fires after the state changes, so remember the old state.
  let visible = document.visibilityState !== "hidden";
  const visibility = () => {
    if (!attempt) return;
    const now = performance.now();
    if (visible && !attempt.paused) attempt.active += Math.max(0, now - attempt.checkpoint);
    attempt.checkpoint = now;
    visible = document.visibilityState !== "hidden";
  };
  const offline = () => { if (attempt) attempt.offline = true; };
  const discard = () => {
    attempt = null;
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("offline", offline);
  };
  return {
    start() {
      if (attempt) return;
      const now = performance.now();
      visible = document.visibilityState !== "hidden";
      attempt = { id: crypto.randomUUID(), started: now, checkpoint: now, active: 0, paused: false, offline: !navigator.onLine };
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("offline", offline);
      if (owner) void trackFunnelEvent("task_started", { task, attempt_id: attempt.id, offline: attempt.offline }, owner);
    },
    pause() { checkpoint(); if (attempt) attempt.paused = true; },
    resume() { checkpoint(); if (attempt) attempt.paused = false; },
    finish(outcome) {
      if (!attempt) return;
      checkpoint();
      const properties = {
        task, attempt_id: attempt.id, outcome,
        active_ms: Math.min(MAX_DURATION, Math.round(attempt.active)),
        elapsed_ms: Math.min(MAX_DURATION, Math.round(Math.max(0, performance.now() - attempt.started))),
        offline: attempt.offline || !navigator.onLine,
      };
      discard();
      if (owner) void trackFunnelEvent("task_finished", properties, owner);
    },
    discard,
  };
}

/** scopeKey only binds in-memory lifetime; it is never transmitted or stored. */
export function useTaskMeasurement(task: MeasuredTask, scopeKey: string, owner: FunnelDeliveryGuard | null): TaskMeasurement & { detach: () => TaskMeasurement } {
  const tenantId = owner?.tenantId;
  const userId = owner?.userId;
  const scoped = useMemo(() => {
    const guard = tenantId && userId ? { tenantId, userId } : null;
    let value = createTaskMeasurement(task, guard);
    const detached = new Set<TaskMeasurement>();
    return { scopeKey,
      api: {
        start: () => value.start(), pause: () => value.pause(), resume: () => value.resume(),
        finish: (outcome: TaskOutcome) => value.finish(outcome), discard: () => value.discard(),
        // Each submitted sale keeps its own attempt while the next cart starts.
        detach: () => {
          const original = value;
          const submitted = { ...original,
            finish: (outcome: TaskOutcome) => { original.finish(outcome); detached.delete(submitted); },
            discard: () => { original.discard(); detached.delete(submitted); },
          };
          detached.add(submitted);
          value = createTaskMeasurement(task, guard);
          return submitted;
        },
      },
      dispose: () => { value.discard(); detached.forEach(item => item.discard()); },
    };
  }, [scopeKey, task, tenantId, userId]);
  useEffect(() => () => scoped.dispose(), [scoped]);
  return scoped.api;
}
