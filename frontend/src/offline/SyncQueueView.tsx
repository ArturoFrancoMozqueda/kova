import { copy } from "../i18n/messages";
import { formatDateTime } from "../orders/format";
import { useIsOnline, useSyncQueue } from "./useSyncQueue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CloudUpload, RefreshCw, AlertCircle, Inbox, Wifi, WifiOff } from "lucide-react";

export default function SyncQueueView() {
  const isOnline = useIsOnline();
  const { pendingCount, failedEntries, syncNow, retryDeadLetter } = useSyncQueue();

  return (
    <main className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.syncQueue.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            {isOnline ? (
              <Badge variant="success" className="gap-1"><Wifi className="h-3 w-3" />{copy.syncQueue.online}</Badge>
            ) : (
              <Badge variant="warning" className="gap-1"><WifiOff className="h-3 w-3" />{copy.register.offline}</Badge>
            )}
          </div>
        </div>
        {isOnline && pendingCount > 0 && (
          <Button onClick={() => void syncNow()}>
            <CloudUpload className="h-4 w-4" />
            {copy.syncQueue.syncNow}
          </Button>
        )}
      </div>

      {pendingCount === 0 && failedEntries.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <Inbox className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{copy.syncQueue.empty}</p>
          </CardContent>
        </Card>
      )}

      {pendingCount > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CloudUpload className="h-4 w-4 text-primary" />
              {copy.syncQueue.pending}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <span className="text-lg font-bold text-primary">{pendingCount}</span>
              </div>
              <div>
                <p className="text-sm font-medium">{copy.register.pendingSales(pendingCount)}</p>
                {!isOnline && <p className="text-xs text-muted-foreground">{copy.syncQueue.willSyncWhenRestored}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {failedEntries.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {copy.syncQueue.failed}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {failedEntries.map((entry) => (
              <div
                key={entry.client_uuid}
                className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 animate-fade-in"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.updated_at)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {copy.syncQueue.attemptCount(entry.attempt_count)}
                    </p>
                    {entry.last_error && (
                      <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {entry.last_error}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2 font-mono">
                      {entry.sale.items.map((i) => `${i.quantity}x${i.product_id.slice(0, 8)}`).join(", ")}
                      {" — "}
                      {entry.sale.payments.map((p) => `${p.method}:${p.amount}`).join(" + ")}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void retryDeadLetter(entry.client_uuid).then(() => void syncNow())}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {copy.syncQueue.retry}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
