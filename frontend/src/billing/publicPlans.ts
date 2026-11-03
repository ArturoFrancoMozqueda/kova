import { useCallback, useEffect, useRef, useState } from "react";
import type { CommercialPlan } from "./types";

export type PublicPlans = { offer_revision?: string; tiered_pricing_enabled: boolean; available_plans: CommercialPlan[] };
export type PublicPlansState = { status: "loading" } | { status: "error" } | { status: "ready"; catalog: PublicPlans };
export function formatCommercialPrice(plan: Pick<CommercialPlan, "amount_minor_units" | "currency" | "interval">) {
  return `${new Intl.NumberFormat("es-MX", { style: "currency", currency: plan.currency, maximumFractionDigits: plan.amount_minor_units % 100 ? 2 : 0 }).format(plan.amount_minor_units / 100)} ${plan.currency}/${plan.interval === "month" ? "mes" : "año"}`;
}
export function publicOfferIdentity(catalog: PublicPlans): string {
  // An older backend can briefly serve Standard during a rolling release.
  return catalog.offer_revision ?? JSON.stringify([catalog.tiered_pricing_enabled, catalog.available_plans]);
}
async function readPublicPlans(signal: AbortSignal): Promise<PublicPlans> {
  const response = await fetch("/api/v1/billing/plans", { credentials: "omit", cache: "no-store", signal });
  if (!response.ok) throw new Error("Offer unavailable");
  const catalog = await response.json() as PublicPlans;
  if (typeof catalog.tiered_pricing_enabled !== "boolean" || !Array.isArray(catalog.available_plans)
    || catalog.available_plans.length === 0 || (catalog.tiered_pricing_enabled && !catalog.offer_revision)
    || catalog.available_plans.some((plan) => !plan.name || !Number.isSafeInteger(plan.amount_minor_units) || plan.amount_minor_units <= 0
      || plan.currency !== "MXN" || plan.interval !== "month" || !Array.isArray(plan.features)
      || !(catalog.tiered_pricing_enabled ? ["esencial", "gestion"].includes(plan.code) : plan.code === "standard"))) throw new Error("Offer unavailable");
  return catalog;
}
/** Public offer comes from the same server switch that assigns signup cohorts. */
export function usePublicPlans(enabled = true) {
  const [state, setState] = useState<PublicPlansState>({ status: "loading" });
  const active = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<Promise<PublicPlans> | null>(null);
  const confirm = useCallback((): Promise<PublicPlans> => {
    if (pending.current) return pending.current;
    const revision = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setState({ status: "loading" });
    const request = readPublicPlans(abort.signal).then((catalog) => {
      if (!active.current || revision !== sequence.current) throw new Error("Offer request superseded");
      setState({ status: "ready", catalog });
      return catalog;
    }).catch((error: unknown) => {
      if (active.current && revision === sequence.current) setState({ status: "error" });
      throw error;
    }).finally(() => { if (pending.current === request) pending.current = null; });
    pending.current = request;
    return request;
  }, []);
  const retry = useCallback(() => { void confirm().catch(() => undefined); }, [confirm]);
  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    retry();
    const onVisible = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active.current = false;
      sequence.current += 1;
      controller.current?.abort();
      pending.current = null;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, retry]);
  return { ...state, retry, confirm };
}
