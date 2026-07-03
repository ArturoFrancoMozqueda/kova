import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { opsCopy } from "../copy";
import { formatRelative } from "../format";
import type { IncidentItem } from "../types";
import { SeverityBadge } from "./SeverityBadge";

const SOURCE_LABEL: Record<string, string> = {
  stripe_webhook: "Stripe",
  subscription: "Suscripción",
  sentry: "Sentry",
  uptimerobot: "UptimeRobot",
  fly: "Fly",
  vercel: "Vercel",
  db: "Base de datos",
};

export function IncidentRow({ incident }: { incident: IncidentItem }) {
  return (
    <Link
      to={`/internal/ops/incidents/${encodeURIComponent(incident.key)}`}
      className="flex items-center gap-3 rounded-lg border border-kova-border bg-white px-4 py-3 hover:bg-muted/40"
    >
      <SeverityBadge severity={incident.severity} />
      <span className="text-xs font-medium text-kova-muted">
        {SOURCE_LABEL[incident.source] ?? incident.source}
      </span>
      <span className="flex-1 truncate text-sm text-kova-ink">{incident.title}</span>
      {incident.triage.status !== "new" ? (
        <Badge variant="outline">{opsCopy.triage[incident.triage.status]}</Badge>
      ) : null}
      <span className="whitespace-nowrap text-xs text-kova-muted">
        {formatRelative(incident.detected_at)}
      </span>
    </Link>
  );
}
