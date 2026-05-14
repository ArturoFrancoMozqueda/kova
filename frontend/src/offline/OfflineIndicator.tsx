import { Link } from "react-router-dom";
import { Wifi, WifiOff, CloudUpload } from "lucide-react";
import { copy } from "../i18n/messages";
import { useIsOnline, useSyncQueue } from "./useSyncQueue";

export function OfflineIndicator() {
  const isOnline = useIsOnline();
  const { pendingCount } = useSyncQueue();

  return (
    <div className="flex items-center gap-2 text-xs">
      {isOnline ? (
        <span className="flex items-center gap-1.5 text-emerald-400">
          <Wifi className="h-3.5 w-3.5" />
          <span className="text-sidebar-muted">Online</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-amber-400">
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
