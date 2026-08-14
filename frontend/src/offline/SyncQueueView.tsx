import { useEffect, useState } from "react";
import { copy } from "../i18n/messages";
import { formatDateTime } from "../orders/format";
import { useIsOnline, useSyncQueue } from "./useSyncQueue";
import { readCatalogCache } from "./catalogCache";
import { useAuth } from "@/auth/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewEmpty } from "@/components/ui/view-states";
import { StatTile } from "@/components/ui/stat-tile";
import { CloudUpload, RefreshCw, AlertCircle, Inbox, Wifi, WifiOff } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function SyncQueueView() {
  useDocumentTitle(copy.documentTitles.syncQueue);
  const isOnline = useIsOnline();
  const { pendingCount, failedEntries, syncNow, retryDeadLetter } = useSyncQueue();
  const { state } = useAuth();
  const tenantId = state.status === "authenticated" ? state.tenantId : null;

  // Nombres reales del catalogo offline (solo lectura) para que las lineas de
  // ventas fallidas digan "Concha" en vez de un id truncado. No toca la cola
  // ni su logica de reintento — si el cache esta vacio/viejo, cae al id.
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void readCatalogCache(tenantId).then((cached) => {
      if (cancelled || !cached) return;
      setProductNames(new Map(cached.products.map((p) => [p.id, p.name])));
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <main className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6 space-y-2">
        <ViewHeader
          title={copy.syncQueue.title}
          actions={
            isOnline && pendingCount > 0 ? (
              <Button onClick={() => void syncNow()} className="self-start">
                <CloudUpload className="h-4 w-4" />
                {copy.syncQueue.syncNow}
              </Button>
            ) : undefined
          }
        />
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Badge variant="success" className="gap-1"><Wifi className="h-3 w-3" />{copy.syncQueue.online}</Badge>
          ) : (
            <Badge variant="warning" className="gap-1"><WifiOff className="h-3 w-3" />{copy.register.offline}</Badge>
          )}
        </div>
      </div>

      {/* Sync state changes (a sale syncs, a retry fails, the network drops)
          happen without navigation; announce the queue counts so SR users
          hear the progress. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {copy.syncQueue.statusAnnouncement(pendingCount, failedEntries.length)}
      </div>

      {pendingCount === 0 && failedEntries.length === 0 && (
        <ViewEmpty
          icon={<Inbox className="h-6 w-6" />}
          title={copy.syncQueue.empty}
          body={copy.syncQueue.emptyBody}
        />
      )}

      {pendingCount > 0 && (
        <div className="mb-4 max-w-xs">
          {/* h3 sr-only: preserva el rol de encabezado "Pendientes" que ya
              asertaban los e2e; StatTile no emite uno propio. */}
          <h3 className="sr-only">{copy.syncQueue.pending}</h3>
          <StatTile
            label={copy.syncQueue.pending}
            value={pendingCount}
            icon={<CloudUpload className="h-4 w-4" />}
            className="bg-kova-grad-sky"
          >
            <p className="text-xs text-kova-muted">{copy.register.pendingSales(pendingCount)}</p>
            {!isOnline && <p className="text-xs text-kova-muted">{copy.syncQueue.willSyncWhenRestored}</p>}
          </StatTile>
        </div>
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
                    <p className="text-xs text-muted-foreground mt-2">
                      {entry.sale.items
                        .map((i) => `${i.quantity}x ${productNames.get(i.product_id) ?? copy.syncQueue.unknownProduct}`)
                        .join(", ")}
                    </p>
                    <details className="mt-1 text-[11px] text-muted-foreground/70">
                      <summary className="cursor-pointer select-none">{copy.syncQueue.technicalDetail}</summary>
                      <p className="mt-1 tabular-nums">
                        {entry.sale.items.map((i) => `${i.quantity}x${i.product_id.slice(0, 8)}`).join(", ")}
                        {" — "}
                        {entry.sale.payments.map((p) => `${p.method}:${p.amount}`).join(" + ")}
                      </p>
                    </details>
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
