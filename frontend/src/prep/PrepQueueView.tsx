import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlarmClock, ChefHat, Undo2 } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { changeCustomerOrderStatus } from "@/customerOrders/api";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { resolveApiErrorMessage, safeUserMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { useIsOnline } from "@/offline/useSyncQueue";
import { changePrepTicketStatus, getPrepQueue, type PrepCard, type PrepStation, type PrepStatus } from "./api";
import { cardTitle, isLate, needsPayment, next, nextLabels, orderStatusFor, previous, statusLabels, waitingMinutes } from "./flow";
import { StationsButton } from "./StationsDialog";

export const PREP_QUEUE_KEY = ["prep-queue"] as const;
const COLUMNS: PrepStatus[] = ["received", "preparing", "ready"];
const ALL = "all";

/** Counter sales and today's pedidos by station, refreshed every few seconds on every device. */
export default function PrepQueueView() {
  useDocumentTitle("Preparación");
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "";
  const isManager = role === "owner" || role === "manager";
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();
  const [station, setStation] = useState<string>(ALL);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: PREP_QUEUE_KEY,
    queryFn: getPrepQueue,
    refetchInterval: isOnline ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const stations = useMemo(() => new Map((data?.stations ?? []).map((item) => [item.id, item])), [data]);
  const cards = (data?.cards ?? []).filter((card) => station === ALL || card.station_id === station);
  const delivered = cards.filter((card) => card.status === "delivered");

  const move = async (card: PrepCard, status: PrepStatus) => {
    if (busy || !isOnline) return;
    setBusy(`${card.kind}:${card.id}:${card.station_id}`);
    setError(null);
    try {
      if (card.kind === "sale") await changePrepTicketStatus(card.id, card.version, status);
      else await changeCustomerOrderStatus(card.id, card.version, orderStatusFor[status]);
      await queryClient.invalidateQueries({ queryKey: PREP_QUEUE_KEY });
    } catch (caught) {
      const message = (caught as { message?: string }).message;
      setError(resolveApiErrorMessage(caught, safeUserMessage(message, "No se pudo actualizar la orden. Revisa su estado e intenta de nuevo.")));
      void refetch();
    } finally {
      setBusy(null);
    }
  };

  if (isPending) return <ViewLayout width="wide"><Skeleton className="h-8 w-48" /><Skeleton className="mt-6 h-72 w-full" /></ViewLayout>;
  if (isError || !data) return <ViewLayout width="wide"><ViewError message="No pudimos cargar la cola de preparación." onRetry={() => void refetch()} retryLabel="Reintentar" /></ViewLayout>;

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      <ViewHeader
        title="Preparación"
        meta="Lo que se cobra en Caja y los pedidos del día, por estación. Se actualiza solo en todos los dispositivos."
        actions={isManager ? <StationsButton onChanged={() => void queryClient.invalidateQueries({ queryKey: PREP_QUEUE_KEY })} /> : undefined}
      />
      {!isOnline ? <p role="status" className="mt-4 rounded-kova-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">Sin conexión: la cola no se actualiza. Las ventas sin conexión llegan aquí al sincronizarse.</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-kova-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}

      {data.stations.length === 0 ? (
        <div className="mt-6">
          <ViewEmpty
            icon={<ChefHat className="h-6 w-6" />}
            title="Aún no hay estaciones de preparación"
            body={isManager
              ? "Crea tus estaciones (por ejemplo Barra y Cocina) y asigna cada producto a la suya en Catálogo. Lo que se cobre en Caja aparecerá aquí."
              : "Pide a gerencia que cree las estaciones y asigne los productos en Catálogo."}
          />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <SegmentedControl
              ariaLabel="Estación"
              options={[{ value: ALL, label: "Todas" }, ...data.stations.map((item) => ({ value: item.id, label: item.name }))]}
              value={station}
              onValueChange={setStation}
            />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((column) => {
              const inColumn = cards.filter((card) => card.status === column);
              return (
                <section key={column} aria-label={statusLabels[column]} className="min-w-0 space-y-3 rounded-kova-lg bg-muted/40 p-3">
                  <h2 className="flex items-center justify-between px-1 text-sm font-semibold">{statusLabels[column]}<span className="tabular-nums text-muted-foreground">{inColumn.length}</span></h2>
                  {inColumn.length === 0 ? <p className="px-1 pb-2 text-sm text-muted-foreground">Sin órdenes.</p> : null}
                  {inColumn.map((card) => (
                    <PrepCardView key={`${card.kind}:${card.id}:${card.station_id}`} card={card} station={stations.get(card.station_id)}
                      showStation={station === ALL && data.stations.length > 1} now={now} busy={busy !== null || !isOnline}
                      isManager={isManager} onMove={(status) => void move(card, status)} />
                  ))}
                </section>
              );
            })}
          </div>
          {delivered.length ? (
            <details className="mt-5 rounded-kova-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Entregados recientemente ({delivered.length})</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {delivered.map((card) => (
                  <PrepCardView key={`${card.kind}:${card.id}:${card.station_id}`} card={card} station={stations.get(card.station_id)}
                    showStation={station === ALL && data.stations.length > 1} now={now} busy={busy !== null || !isOnline}
                    isManager={isManager} onMove={(status) => void move(card, status)} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </ViewLayout>
  );
}

type CardProps = {
  card: PrepCard;
  station: PrepStation | undefined;
  showStation: boolean;
  now: number;
  busy: boolean;
  isManager: boolean;
  onMove: (status: PrepStatus) => void;
};

function PrepCardView({ card, station, showStation, now, busy, isManager, onMove }: CardProps) {
  const following = next(card.status);
  const back = previous(card.status);
  const late = isLate(card, station?.alert_minutes ?? 8, now);
  const minutes = waitingMinutes(card, now);
  return (
    <Card className={cn("shadow-none", late && "border-destructive/60 ring-1 ring-destructive/30")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xl font-bold tabular-nums leading-none">{cardTitle(card)}</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">{[card.kind === "customer_order" ? "Pedido" : null, card.customer_name, showStation ? station?.name : null].filter(Boolean).join(" · ") || "Mostrador"}</p>
          </div>
          {card.status !== "delivered" ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", late ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
              <AlarmClock className="h-3.5 w-3.5" aria-hidden="true" />{minutes} min{late ? " · tarde" : ""}
            </span>
          ) : null}
        </div>
        <ul className="space-y-1.5 text-sm">
          {card.items.map((item, index) => (
            <li key={index}>
              <span className="font-semibold tabular-nums">{item.quantity}×</span> {item.product_name}
              {item.modifiers.length ? <span className="block pl-6 text-xs text-muted-foreground">{item.modifiers.join(" · ")}</span> : null}
              {item.note ? <span className="block pl-6 text-xs font-medium text-primary">Nota: {item.note}</span> : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {following && !needsPayment(card) ? <Button size="sm" disabled={busy} onClick={() => onMove(following)}>{nextLabels[card.status]}</Button> : null}
          {needsPayment(card) ? <Link to={`/register?customerOrderId=${card.id}`} className={buttonVariants({ size: "sm" })}>Cobrar en Caja</Link> : null}
          {isManager && back ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMove(back)} aria-label={`Regresar ${cardTitle(card)} a ${statusLabels[back]}`}><Undo2 className="mr-1 h-4 w-4" /> Regresar</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}
