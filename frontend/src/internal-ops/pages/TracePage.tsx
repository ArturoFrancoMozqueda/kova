import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { useTrace } from "../hooks";
import { ExternalLink } from "../components/ExternalLink";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { TraceTimeline, type TimelineItem } from "../components/TraceTimeline";
import { ErrorState, SectionEmptyState } from "../components/states";
import type { OpsStatus, TraceParams } from "../types";

const FIELDS: { key: keyof TraceParams; label: string }[] = [
  { key: "request_id", label: "Request ID" },
  { key: "tenant_id", label: "Tenant ID" },
  { key: "user_id", label: "User ID" },
  { key: "stripe_event_id", label: "Stripe Event ID" },
  { key: "from", label: "Desde" },
  { key: "to", label: "Hasta" },
];

function paramsFromSearch(search: URLSearchParams): TraceParams {
  const out: TraceParams = {};
  for (const { key } of FIELDS) {
    const value = search.get(key);
    if (value) out[key] = value;
  }
  return out;
}

const KNOWN_STATUSES: OpsStatus[] = ["ok", "warning", "critical", "degraded", "not_configured"];

export default function TracePage() {
  const [search, setSearch] = useSearchParams();
  const active = paramsFromSearch(search);
  const [form, setForm] = useState<TraceParams>(active);
  const query = useTrace(active);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const { key } of FIELDS) {
      const value = form[key]?.trim();
      if (value) next.set(key, value);
    }
    setSearch(next, { replace: true });
  };

  const timelineItems: TimelineItem[] =
    query.data?.timeline.map((event) => ({
      ts: event.ts,
      source: event.source,
      kind: event.kind,
      summary: event.summary,
      correlation: event.correlation,
      deep_link: event.deep_link,
    })) ?? [];

  return (
    <>
      <PageHeader title={opsCopy.nav.trace} updatedAt={query.data?.generated_at} />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map(({ key, label }) => (
              <label key={key} className="text-xs font-medium text-kova-muted">
                {label}
                <Input
                  type={key === "from" || key === "to" ? "datetime-local" : "text"}
                  value={form[key] ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="mt-1"
                />
              </label>
            ))}
            <div className="flex items-end">
              <Button type="submit">Buscar</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {query.data ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-kova-muted">
          {Object.entries(query.data.sources_queried).map(([name, status]) => (
            <span key={name} className="flex items-center gap-1">
              {name}:
              {KNOWN_STATUSES.includes(status as OpsStatus) ? (
                <StatusBadge status={status as OpsStatus} />
              ) : (
                <span className="font-medium">{status}</span>
              )}
            </span>
          ))}
          {Object.entries(query.data.deep_links).map(([name, url]) => (
            <ExternalLink key={name} label={name} url={url} />
          ))}
        </div>
      ) : null}

      {!query.isFetching && Object.keys(active).length === 0 ? (
        <SectionEmptyState label="Ingresa un identificador o rango para buscar la traza." />
      ) : query.isFetching ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />
      ) : timelineItems.length === 0 ? (
        <SectionEmptyState label="Sin eventos para estos criterios." />
      ) : (
        <TraceTimeline items={timelineItems} />
      )}
    </>
  );
}
