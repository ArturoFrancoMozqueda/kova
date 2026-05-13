import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { useIsOnline, useSyncQueue } from "./useSyncQueue";

export function OfflineIndicator() {
  const isOnline = useIsOnline();
  const { pendingCount } = useSyncQueue();

  if (isOnline && pendingCount === 0) return null;

  return (
    <Link
      to="/sync-queue"
      className="text-link"
      aria-label={
        !isOnline
          ? copy.register.offline
          : copy.register.pendingSales(pendingCount)
      }
    >
      {!isOnline
        ? copy.register.offline
        : copy.register.pendingSales(pendingCount)}
    </Link>
  );
}
