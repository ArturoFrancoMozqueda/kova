import { Link } from "react-router-dom";
import { Wifi, WifiOff, CloudUpload } from "lucide-react";
import { copy } from "../i18n/messages";
import { useIsOnline, useSyncQueue } from "./useSyncQueue";

export function OfflineIndicator({
  compact = false,
  showOnlineLabel = false,
}: {
  compact?: boolean;
  showOnlineLabel?: boolean;
} = {}) {
  const isOnline = useIsOnline();
  const { pendingCount } = useSyncQueue();

  // Compact variant for the mobile top bar (light surface): connection state is
  // always visible so offline/queue status persists during POS, where the
  // sidebar footer is hidden. Online collapses to a single icon; offline and a
  // non-empty queue expand with a label / count.
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        {isOnline ? (
          <span className="flex items-center gap-1.5 rounded-full bg-kova-growth/10 px-2.5 py-1.5 font-medium text-kova-growth" title={copy.register.online}>
            <Wifi className="h-4 w-4" aria-label={copy.register.online} />
            {showOnlineLabel ? <span>Sincronizado</span> : null}
          </span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-warning-strong">
            <WifiOff className="h-4 w-4" />
            {copy.register.offline}
          </span>
        )}
        {pendingCount > 0 && (
          <Link
            to="/sync-queue"
            aria-label={copy.register.pendingSales(pendingCount)}
            className="flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 font-medium text-warning-foreground"
          >
            <CloudUpload className="h-3.5 w-3.5" />
            <span className="tabular-nums">{pendingCount}</span>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {isOnline ? (
        <span className="flex items-center gap-1.5 text-kova-growth">
          <Wifi className="h-3.5 w-3.5" />
          <span className="text-sidebar-muted">{copy.register.online}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-warning">
          <WifiOff className="h-3.5 w-3.5" />
          <span>{copy.register.offline}</span>
        </span>
      )}
      {pendingCount > 0 && (
        <Link
          to="/sync-queue"
          className="flex items-center gap-1.5 rounded-md bg-sidebar-accent/50 px-2 py-1 text-sidebar-muted hover:text-sidebar-foreground transition-colors"
        >
          <CloudUpload className="h-3 w-3" />
          {copy.register.pendingSales(pendingCount)}
        </Link>
      )}
    </div>
  );
}
