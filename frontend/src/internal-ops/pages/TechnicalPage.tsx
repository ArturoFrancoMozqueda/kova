import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { opsCopy } from "../copy";
import { useTechnical } from "../hooks";
import { ExternalLink } from "../components/ExternalLink";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState, NotConfiguredCard } from "../components/states";
import type { TechnicalSource } from "../types";

type IssueRow = { title?: string; permalink?: string; count_24h?: number };
type MonitorRow = { name?: string; uptime_7d?: number | null; deep_link?: string };

function SourceCard({ title, source, children }: { title: string; source: TechnicalSource; children?: React.ReactNode }) {
  if (source.status === "not_configured") {
    return <NotConfiguredCard label={`${title}: ${opsCopy.common.notConfigured}`} />;
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <StatusBadge status={source.status} />
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-kova-ink">
        {source.error_summary ? (
          <p className="text-xs text-kova-muted">{source.error_summary}</p>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

export default function TechnicalPage() {
  const query = useTechnical();

  if (query.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={resolveApiErrorMessage(query.error, opsCopy.common.loadError)} onRetry={query.refetch} />;
  }

  const { db, uptimerobot, sentry, fly, vercel } = query.data;
  const issues = (sentry.data?.issues as IssueRow[] | undefined) ?? [];
  const monitors = (uptimerobot.data?.monitors as MonitorRow[] | undefined) ?? [];
  const machines = (fly.data?.machines as { machine_id?: string; state?: string; region?: string }[] | undefined) ?? [];
  const deployment = vercel.data?.latest_production_deployment as
    | { state?: string; commit_message?: string; deep_link?: string | null }
    | null
    | undefined;

  return (
    <>
      <PageHeader title={opsCopy.nav.technical} updatedAt={query.data.generated_at} />
      <div className="grid gap-4 md:grid-cols-2">
        <SourceCard title="Base de datos" source={db}>
          <p>Latencia: {(db.data?.latency_ms as number | undefined) ?? "—"} ms</p>
        </SourceCard>

        <SourceCard title="UptimeRobot" source={uptimerobot}>
          {monitors.map((m, i) => (
            <div key={i} className="flex items-center justify-between">
              <span>{m.name}</span>
              <span className="text-kova-muted">{m.uptime_7d != null ? `${m.uptime_7d}% (7d)` : "—"}</span>
            </div>
          ))}
        </SourceCard>

        <SourceCard title="Sentry" source={sentry}>
          <p className="text-kova-muted">Sin resolver (24h): {(sentry.data?.unresolved_24h as number | undefined) ?? 0}</p>
          {issues.slice(0, 5).map((issue, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{issue.title}</span>
              {issue.permalink ? <ExternalLink label="ver" url={issue.permalink} /> : null}
            </div>
          ))}
        </SourceCard>

        <SourceCard title="Fly" source={fly}>
          {machines.map((m, i) => (
            <div key={i} className="flex items-center justify-between">
              <span>{m.region}</span>
              <span className="text-kova-muted">{m.state}</span>
            </div>
          ))}
        </SourceCard>

        <SourceCard title="Vercel" source={vercel}>
          {deployment ? (
            <>
              <p>Estado: {deployment.state}</p>
              {deployment.commit_message ? <p className="truncate text-kova-muted">{deployment.commit_message}</p> : null}
              {deployment.deep_link ? <ExternalLink label="Ver deployment" url={deployment.deep_link} /> : null}
            </>
          ) : (
            <p className="text-kova-muted">Sin deployments.</p>
          )}
        </SourceCard>
      </div>
    </>
  );
}
