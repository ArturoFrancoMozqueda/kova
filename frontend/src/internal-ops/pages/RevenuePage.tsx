import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { formatDateTime, formatMinorUnits, formatRelative } from "../format";
import { useRevenue } from "../hooks";
import { ExternalLink } from "../components/ExternalLink";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState, SectionEmptyState } from "../components/states";

export default function RevenuePage() {
  const query = useRevenue();

  if (query.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />;
  }

  const data = query.data;
  const wh = data.webhook_health;

  return (
    <>
      <PageHeader title={opsCopy.nav.revenue} updatedAt={data.generated_at} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="MRR (activos)" value={formatMinorUnits(data.mrr_minor_units, data.currency)} />
        <KpiCard label="MRR en prueba" value={formatMinorUnits(data.trialing_mrr_minor_units, data.currency)} />
        <KpiCard label="Cancelando" value={data.canceling_count} />
        <KpiCard
          label="Webhooks fallidos (7d)"
          value={wh.failed_7d}
          status={wh.status}
          hint={wh.stuck_received_1h > 0 ? `${wh.stuck_received_1h} atascados` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pruebas activas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.trials.length === 0 ? (
              <SectionEmptyState />
            ) : (
              data.trials.map((t) => (
                <div key={t.tenant_id} className="flex items-center justify-between text-sm">
                  <span className="text-kova-ink">{t.tenant_name}</span>
                  <span className="text-kova-muted">vence {formatRelative(t.trial_ends_at)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pagos vencidos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.past_due.length === 0 ? (
              <SectionEmptyState />
            ) : (
              data.past_due.map((p) => (
                <div key={p.tenant_id} className="flex items-center justify-between text-sm">
                  <span className="text-kova-ink">{p.tenant_name}</span>
                  <span className="text-kova-muted">gracia {formatRelative(p.grace_period_ends_at)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Webhooks fallidos recientes</CardTitle>
          <StatusBadge status={wh.status} />
        </CardHeader>
        <CardContent className="space-y-2">
          {wh.recent_failures.length === 0 ? (
            <SectionEmptyState label="Sin fallos recientes." />
          ) : (
            wh.recent_failures.map((f) => (
              <div key={f.stripe_event_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-kova-ink">{f.event_type}</span>
                <span className="text-kova-muted">{f.error_reason ?? "—"}</span>
                <span className="text-xs text-kova-muted">{formatDateTime(f.created_at)}</span>
                {f.deep_link ? <ExternalLink label="Stripe" url={f.deep_link} /> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
