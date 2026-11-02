import type { CommercialAccess } from "@/auth/types";

export type PlanCode = "standard" | "esencial" | "gestion";
export type PlanFeature = "pos" | "inventory" | "sales_reports" | "public_catalog"
  | "purchasing" | "advanced_reports" | "loyalty" | "customer_orders" | "quotes";

/** Presentation only: every API mutation still requires the server's entitlement and RBAC. */
export function hasPlanFeature(access: CommercialAccess | undefined, feature: PlanFeature): boolean {
  if (access?.allowed === false) return false;
  // Old session payloads belong to the existing single-plan contract. Explicit
  // new-plan payloads without their feature list fail closed instead.
  if (access?.features === undefined) return access?.plan_code === undefined;
  return access.features.includes(feature);
}

export function commercialPlanIdentity(access: CommercialAccess | undefined): string | undefined {
  if (!access?.plan_code && access?.features === undefined) return undefined;
  return JSON.stringify([access.plan_code, [...(access.features ?? [])].sort(), access.limits?.product_image_bytes, access.limits?.branches]);
}

export const PLAN_FEATURE_LABELS: Record<string, string> = {
  pos: "Caja, turnos, cortes y recibos", inventory: "Catálogo y existencias", sales_reports: "Resumen de ventas",
  public_catalog: "Catálogo público y QR", purchasing: "Compras y proveedores", advanced_reports: "Análisis del negocio",
  loyalty: "Lealtad y recompensas", customer_orders: "Seguimiento de pedidos", quotes: "Cotizaciones",
};
