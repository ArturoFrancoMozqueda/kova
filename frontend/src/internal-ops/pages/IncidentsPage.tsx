import { useSearchParams } from "react-router-dom";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { useIncidents } from "../hooks";
import { IncidentRow } from "../components/IncidentRow";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState, SectionEmptyState } from "../components/states";

const SEVERITIES = ["critical", "warning", "info"];
const SOURCES = ["stripe_webhook", "subscription", "sentry", "uptimerobot", "fly", "vercel", "db"];
const TRIAGE = ["new", "acknowledged", "investigating", "resolved", "ignored"];

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    severity: params.get("severity") ?? undefined,
    source: params.get("source") ?? undefined,
    triage_status: params.get("triage_status") ?? undefined,
  };
  const query = useIncidents(filters);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title={opsCopy.nav.incidents} updatedAt={query.data?.generated_at} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="max-w-40" value={filters.severity ?? ""} onChange={(e) => setFilter("severity", e.target.value)}>
          <option value="">Toda severidad</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {opsCopy.severity[s as keyof typeof opsCopy.severity]}
            </option>
          ))}
        </Select>
        <Select className="max-w-40" value={filters.source ?? ""} onChange={(e) => setFilter("source", e.target.value)}>
          <option value="">Toda fuente</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select className="max-w-40" value={filters.triage_status ?? ""} onChange={(e) => setFilter("triage_status", e.target.value)}>
          <option value="">Todo estado</option>
          {TRIAGE.map((s) => (
            <option key={s} value={s}>
              {opsCopy.triage[s as keyof typeof opsCopy.triage]}
            </option>
          ))}
        </Select>
      </div>

      {query.data && query.data.degraded_sources.length > 0 ? (
        <div className="mb-3 flex items-center gap-2 text-xs text-kova-muted">
          <StatusBadge status="degraded" />
          Fuentes sin señal: {query.data.degraded_sources.join(", ")}
        </div>
      ) : null}

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />
      ) : query.data.items.length === 0 ? (
        <SectionEmptyState label="Sin incidentes en este filtro." />
      ) : (
        <div className="space-y-2">
          {query.data.items.map((incident) => (
            <IncidentRow key={incident.key} incident={incident} />
          ))}
        </div>
      )}
    </>
  );
}
