import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { formatMinorUnits, formatRelative } from "../format";
import { useTenants } from "../hooks";
import { ExternalLink } from "../components/ExternalLink";
import { PageHeader } from "../components/PageHeader";
import { ErrorState, SectionEmptyState } from "../components/states";
import type { TenantItem } from "../types";

const RISK_LABELS: Record<string, string> = {
  trial_expiring: "Prueba por vencer",
  past_due: "Pago vencido",
  no_sales_14d: "Sin ventas 14d",
  never_activated: "Nunca activó",
};

function TenantCard({ tenant }: { tenant: TenantItem }) {
  const b = tenant.billing;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium text-kova-ink">{tenant.name}</p>
            <p className="text-xs text-kova-muted">{tenant.owner_email ?? "sin owner"}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {tenant.risk_flags.map((flag) => (
              <Badge key={flag} variant="warning">
                {RISK_LABELS[flag] ?? flag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span className="text-kova-muted">Plan</span>
          <span className="text-kova-ink">{b.status ?? "sin suscripción"}</span>
          <span className="text-kova-muted">MRR</span>
          <span className="text-kova-ink">
            {b.amount_minor_units != null ? formatMinorUnits(b.amount_minor_units, b.currency ?? "MXN") : "—"}
          </span>
          <span className="text-kova-muted">Activación</span>
          <span className="text-kova-ink">{tenant.activation.completed_count}/5</span>
          <span className="text-kova-muted">Ventas 7d / 30d</span>
          <span className="text-kova-ink">
            {tenant.usage.orders_7d} / {tenant.usage.orders_30d}
          </span>
          <span className="text-kova-muted">Última venta</span>
          <span className="text-kova-ink">{formatRelative(tenant.usage.last_order_at)}</span>
        </div>
        <div className="flex gap-3 pt-1">
          <a
            href={`/internal/ops/trace?tenant_id=${tenant.tenant_id}`}
            className="text-xs font-medium text-[color:var(--kova-blue)] hover:underline"
          >
            Ver trace
          </a>
          {b.stripe_customer_deep_link ? <ExternalLink label="Stripe" url={b.stripe_customer_deep_link} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function TenantsPage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("tenant_id") ?? "");
  const deferredSearch = useDeferredValue(search.trim());
  const query = useTenants(deferredSearch);
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader title={opsCopy.nav.tenants} updatedAt={query.data?.generated_at} />
      <Input
        placeholder="Buscar por nombre o email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />
      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />
      ) : items.length === 0 ? (
        <SectionEmptyState label="Sin clientes que coincidan." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((tenant) => (
            <TenantCard key={tenant.tenant_id} tenant={tenant} />
          ))}
        </div>
      )}
    </>
  );
}
