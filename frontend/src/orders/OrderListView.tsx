import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { listOrders } from "./api";
import type { OrderFilters } from "./api";
import { formatMoney } from "./format";
import type { OrderListItem } from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, AlertCircle, Inbox, X } from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; items: OrderListItem[]; total: number };

type StatusFilter = "completed" | "voided" | undefined;

export default function OrderListView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(undefined);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const hasActiveFilter = statusFilter !== undefined || startDate !== "" || endDate !== "";

  const load = useCallback(
    async (filters: OrderFilters = {}) => {
      setLoadState({ status: "loading" });
      try {
        const result = await listOrders(filters);
        setLoadState({ status: "loaded", items: result.items, total: result.total });
      } catch {
        setLoadState({ status: "error" });
      }
    },
    [],
  );

  useEffect(() => {
    void load({ status: statusFilter, startDate: startDate || undefined, endDate: endDate || undefined });
  }, [load, statusFilter, startDate, endDate]);

  const clearFilters = () => {
    setStatusFilter(undefined);
    setStartDate("");
    setEndDate("");
  };

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: undefined, label: copy.orderList.allStatuses },
    { value: "completed", label: copy.orderList.filterCompleted },
    { value: "voided", label: copy.orderList.filterVoided },
  ];

  if (loadState.status === "loading") {
    return (
      <main className="p-6 lg:p-8 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-12 w-full mb-4" />
        <Card>
          <CardContent className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="p-6 lg:p-8 max-w-5xl mx-auto">
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
            <div>
              <p className="font-medium">{copy.orderList.loadError}</p>
              <p className="text-sm text-muted-foreground">{copy.orderList.connectionHint}</p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void load({
                  status: statusFilter,
                  startDate: startDate || undefined,
                  endDate: endDate || undefined,
                })
              }
              className="ml-auto"
            >
              {copy.orderList.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.orderList.title}</h1>
          <p className="text-sm text-muted-foreground">
            {loadState.total} {copy.orderList.total}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-end mb-4 rounded-xl border bg-muted/30 p-4"
        aria-label={copy.orderList.filterLabel}
      >
        {/* Status pills */}
        <div className="flex gap-1.5 flex-wrap">
          {statusOptions.map(({ value, label }) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                statusFilter === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-background border hover:border-primary/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-end gap-2 flex-1">
          <div className="space-y-1 flex-1 min-w-0">
            <Label className="text-xs">{copy.orderList.filterStartDate}</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <Label className="text-xs">{copy.orderList.filterEndDate}</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Clear */}
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="shrink-0 gap-1.5 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {copy.orderList.clearFilters}
          </Button>
        )}
      </div>

      {/* Results */}
      {loadState.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{copy.orderList.empty}</p>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-2 text-sm text-primary hover:underline"
              >
                {copy.orderList.clearFilters}
              </button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="grid gap-3 p-3 sm:hidden">
              {loadState.items.map((order) => (
                <Link
                  key={order.id}
                  to={`/orders/${order.id}`}
                  className="rounded-lg border bg-background p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {new Intl.DateTimeFormat(navigator.language, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(order.created_at))}
                      </p>
                      <Badge
                        className="mt-2"
                        variant={order.status === "voided" ? "destructive" : "success"}
                      >
                        {order.status === "voided"
                          ? copy.orderList.filterVoided
                          : copy.orderList.filterCompleted}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(order.total_amount)}</p>
                      <p className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                        {copy.orderList.view}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-semibold">{copy.orderList.date}</th>
                    <th className="text-left px-4 py-3 font-semibold">{copy.orderList.status}</th>
                    <th className="text-right px-4 py-3 font-semibold">{copy.orderList.amount}</th>
                    <th className="px-4 py-3 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {loadState.items.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Intl.DateTimeFormat(navigator.language, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(order.created_at))}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={order.status === "voided" ? "destructive" : "success"}
                        >
                          {order.status === "voided"
                            ? copy.orderList.filterVoided
                            : copy.orderList.filterCompleted}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatMoney(order.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/orders/${order.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {copy.orderList.view}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
