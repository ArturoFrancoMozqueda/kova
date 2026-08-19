import { Link } from "react-router-dom";
import { formatDateTime } from "../format";
import type { IncidentCorrelation } from "../types";
import { ExternalLink } from "./ExternalLink";

export type TimelineItem = {
  ts: string | null;
  source?: string;
  kind: string;
  summary: string;
  correlation?: IncidentCorrelation | null;
  deep_link?: string | null;
  actor?: string | null;
};

function CorrelationLinks({ correlation }: { correlation: IncidentCorrelation }) {
  const links: { label: string; to: string }[] = [];
  if (correlation.tenant_id) {
    links.push({ label: `tenant ${correlation.tenant_id.slice(0, 8)}`, to: `/internal/ops/tenants?tenant_id=${correlation.tenant_id}` });
  }
  if (correlation.request_id) {
    links.push({ label: `request ${correlation.request_id.slice(0, 8)}`, to: `/internal/ops/trace?request_id=${correlation.request_id}` });
  }
  if (correlation.user_id) {
    links.push({ label: `user ${correlation.user_id.slice(0, 8)}`, to: `/internal/ops/trace?user_id=${correlation.user_id}` });
  }
  if (correlation.stripe_event_id) {
    links.push({ label: `stripe ${correlation.stripe_event_id.slice(0, 12)}`, to: `/internal/ops/trace?stripe_event_id=${correlation.stripe_event_id}` });
  }
  if (links.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link key={link.to} to={link.to} className="text-xs text-[color:var(--kova-blue)] hover:underline">
          {link.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Chronological trace timeline shared by the incident detail and the trace
 * search page. Sorts ascending; events without a timestamp sink to the end.
 */
export function TraceTimeline({ items }: { items: TimelineItem[] }) {
  const sorted = [...items].sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.ts ? new Date(b.ts).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return (
    <ol className="relative space-y-4 border-l border-kova-border pl-5">
      {sorted.map((item, index) => (
        <li key={`${item.kind}-${index}`} className="relative">
          <span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full bg-[color:var(--kova-blue)]" />
          <div className="flex flex-wrap items-baseline gap-2">
            {item.source ? (
              <span className="text-xs font-medium uppercase tracking-wide text-kova-muted">{item.source}</span>
            ) : null}
            <span className="text-xs text-kova-muted">{formatDateTime(item.ts)}</span>
            {item.actor ? <span className="text-xs text-kova-muted">· {item.actor}</span> : null}
          </div>
          <p className="text-sm text-kova-ink">{item.summary}</p>
          {item.correlation ? <CorrelationLinks correlation={item.correlation} /> : null}
          {item.deep_link ? (
            <div className="mt-1">
              <ExternalLink label={item.source ?? "Abrir"} url={item.deep_link} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
