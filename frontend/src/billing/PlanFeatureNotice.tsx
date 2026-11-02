import type { ReactNode } from "react";
import { BILLING_VIEW_PERMISSION, usePermission } from "@/auth/permissions";
import { Link } from "react-router-dom";

export function PlanFeatureNotice({ children }: { children?: ReactNode }) {
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);
  return <aside className="rounded-kova-md border border-kova-blue/20 bg-kova-blue/5 p-4 text-sm" aria-label="Funciones del plan">
    <p>{children ?? "Tu historial se conserva. Para iniciar nuevas operaciones de este módulo necesitas el Plan Gestión."}</p>
    {canViewBilling && <Link className="mt-2 inline-flex min-h-11 items-center font-medium text-kova-blue underline" to="/settings/billing">Consultar mi suscripción</Link>}
  </aside>;
}
