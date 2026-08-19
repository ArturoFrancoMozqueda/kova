import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { formatMinorUnits } from "../format";
import { useOverview } from "../hooks";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState } from "../components/states";
import type { OpsStatus } from "../types";

const SOURCE_LABELS: Record<string, string> = {
  db: "Base de datos",
  stripe_webhooks: "Webhooks Stripe",
  sentry: "Sentry",
  fly: "Fly",
  vercel: "Vercel",
  uptimerobot: "UptimeRobot",
};

export default function OverviewPage() {
  const query = useOverview();

  if (query.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />;
  }

  const { growth, health, money, risk, operations } = query.data;

  return (
    <>
      <PageHeader title={opsCopy.nav.overview} updatedAt={query.data.generated_at}>
        <StatusBadge status={health.overall} />
      </PageHeader>

      <section className="mb-6" aria-labelledby="growth-truths-title">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="growth-truths-title" className="text-sm font-medium text-kova-muted">
            Las cuatro verdades
          </h2>
          <p className="text-xs text-kova-muted">Histórico real de Postgres, no telemetría</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Usuarios creados" value={growth.users_created} hint="Cuentas registradas" />
          <KpiCard label="Usuarios verificados" value={growth.users_verified} hint="Correo confirmado" />
          <KpiCard
            label="Negocios activados"
            value={growth.tenants_with_completed_sale}
            hint="Con al menos una venta completada"
          />
          <KpiCard
            label="Negocios pagando"
            value={growth.paying_tenants}
            hint="Pago live procesado y suscripción activa"
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-kova-muted">Estado general</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(health.sources).map(([key, source]) => (
            <Link key={key} to="/internal/ops/technical">
              <Card className="hover:bg-muted/30">
                <CardContent className="flex items-center justify-between p-4">
                  <span className="text-sm text-kova-ink">{SOURCE_LABELS[key] ?? key}</span>
                  <StatusBadge status={source.status as OpsStatus} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-kova-muted">Dinero</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="MRR (activos)" value={formatMinorUnits(money.mrr_minor_units, money.currency)} />
          <KpiCard label="Suscripciones activas" value={money.active} />
          <KpiCard label="En prueba" value={money.trialing} />
          <KpiCard label="Cancelando" value={money.canceling} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-kova-muted">Riesgo y operación</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Webhooks fallidos (24h)"
            value={risk.failed_webhooks_24h}
            status={risk.failed_webhooks_24h > 0 ? "warning" : "ok"}
          />
          <KpiCard
            label="Pagos vencidos"
            value={risk.past_due_tenants}
            status={risk.past_due_tenants > 0 ? "warning" : "ok"}
          />
          <KpiCard label="Pruebas por vencer (7d)" value={risk.trials_expiring_7d} />
          <KpiCard
            label="Gracia vencida"
            value={risk.grace_period_expired}
            status={risk.grace_period_expired > 0 ? "critical" : "ok"}
          />
          <KpiCard label="Ventas (24h)" value={operations.orders_24h} />
          <KpiCard label="Monto vendido (24h)" value={`$${operations.sales_24h_amount}`} />
          <KpiCard label="Altas (7d)" value={operations.signups_7d} />
          <KpiCard label="Clientes activos (7d)" value={operations.tenants_active_7d} />
        </div>
      </section>

      <Link to="/internal/ops/incidents" className="text-sm font-medium text-[color:var(--kova-blue)] hover:underline">
        {opsCopy.common.viewAll} → {opsCopy.nav.incidents}
      </Link>
    </>
  );
}
