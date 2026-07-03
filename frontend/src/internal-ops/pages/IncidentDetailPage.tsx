import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { formatDateTime } from "../format";
import { useIncident } from "../hooks";
import { ExternalLink } from "../components/ExternalLink";
import { IncidentNotes } from "../components/IncidentNotes";
import { PageHeader } from "../components/PageHeader";
import { SeverityBadge } from "../components/SeverityBadge";
import { TraceTimeline, type TimelineItem } from "../components/TraceTimeline";
import { TriageStatusSelect } from "../components/TriageStatusSelect";
import { ErrorState } from "../components/states";

export default function IncidentDetailPage() {
  const { incidentKey = "" } = useParams();
  const query = useIncident(incidentKey);

  if (query.isPending) {
    return <Skeleton className="h-96" />;
  }
  if (query.isError) {
    return <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />;
  }

  const { incident, timeline, notes } = query.data;
  const timelineItems: TimelineItem[] = timeline.map((event) => ({
    ts: event.ts,
    kind: event.kind,
    summary: event.summary,
    actor: event.actor,
  }));

  return (
    <>
      <Link to="/internal/ops/incidents" className="text-sm text-[color:var(--kova-blue)] hover:underline">
        ← {opsCopy.nav.incidents}
      </Link>
      <PageHeader title={incident.title}>
        <SeverityBadge severity={incident.severity} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Línea de tiempo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TraceTimeline items={timelineItems} />
            {incident.deep_links.length > 0 ? (
              <div className="flex flex-wrap gap-3 border-t border-kova-border pt-3">
                {incident.deep_links.map((link) => (
                  <ExternalLink key={link.url} label={link.label} url={link.url} />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Triage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <TriageStatusSelect incidentKey={incident.key} current={incident.triage.status} />
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-kova-muted">Detectado</dt>
                  <dd className="text-kova-ink">{formatDateTime(incident.detected_at)}</dd>
                </div>
                {incident.correlation.tenant_id ? (
                  <div className="flex justify-between">
                    <dt className="text-kova-muted">Tenant</dt>
                    <dd>
                      <Link
                        to={`/internal/ops/trace?tenant_id=${incident.correlation.tenant_id}`}
                        className="text-[color:var(--kova-blue)] hover:underline"
                      >
                        ver trace
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <IncidentNotes
                incidentKey={incident.key}
                source={incident.source}
                externalId={incident.external_id}
                notes={notes}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
