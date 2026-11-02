import { useEffect, useState } from "react";
import type { CommercialPlan } from "./types";

export type PublicPlans = { tiered_pricing_enabled: boolean; available_plans: CommercialPlan[] };
export type PublicPlansState = { status: "loading" } | { status: "error" } | { status: "ready"; catalog: PublicPlans };
export function formatCommercialPrice(plan: Pick<CommercialPlan, "amount_minor_units" | "currency" | "interval">) {
  return `${new Intl.NumberFormat("es-MX", { style: "currency", currency: plan.currency, maximumFractionDigits: plan.amount_minor_units % 100 ? 2 : 0 }).format(plan.amount_minor_units / 100)} ${plan.currency}/${plan.interval === "month" ? "mes" : "año"}`;
}
/** Public offer comes from the same server switch that assigns signup cohorts. */
export function usePublicPlans(enabled = true) {
  const [state, setState] = useState<PublicPlansState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/v1/billing/plans", { credentials: "omit", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Offer unavailable");
        const catalog = await response.json() as PublicPlans;
        if (typeof catalog.tiered_pricing_enabled !== "boolean" || !Array.isArray(catalog.available_plans)
          || catalog.available_plans.length === 0 || catalog.available_plans.some((plan) => !plan.name || !Number.isSafeInteger(plan.amount_minor_units) || plan.amount_minor_units <= 0
            || plan.currency !== "MXN" || plan.interval !== "month" || !Array.isArray(plan.features)
            || !(catalog.tiered_pricing_enabled ? ["esencial", "gestion"].includes(plan.code) : plan.code === "standard"))) throw new Error("Offer unavailable");
        if (!controller.signal.aborted) setState({ status: "ready", catalog });
      } catch { if (!controller.signal.aborted) setState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [enabled, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
