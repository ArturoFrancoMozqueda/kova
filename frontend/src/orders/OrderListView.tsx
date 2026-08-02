import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { listOrders } from "./api";
import type { OrderFilters } from "./api";
import { formatMoney, formatDateTime } from "./format";
import { Card, CardContent } from "@/components/ui/card";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewEmpty } from "@/components/ui/view-states";
import { ExternalLink, AlertCircle, Inbox, X, CheckCircle2, Ban } from "lucide-react";

type StatusFilter = "completed" | "voided" | undefined;
type OrderSort = "created_desc" | "created_asc" | "amount_desc" | "amount_asc";
type PeriodPreset = "today" | "week" | "month" | null;

function dateInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<PeriodPreset, null>): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  if (preset === "week") start.setDate(end.getDate() - 6);
  if (preset === "month") start.setDate(end.getDate() - 29);
  return { start: dateInputValue(start), end: dateInputValue(end) };
}

export default function OrderListView() {
  useDocumentTitle(copy.documentTitles.orders);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(undefined);
  const initialPeriod = presetRange("today");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("today");
  const [startDate, setStartDate] = useState(initialPeriod.start);
  const [endDate, setEndDate] = useState(initialPeriod.end);
  const [sortOrder, setSortOrder] = useState<OrderSort>("created_desc");

  const hasActiveFilter = statusFilter !== undefined || startDate !== "" || endDate !== "";

  // Cached + deduped via react-query: navigating away and back within the
  // stale window reuses the result instead of re-hitting the backend.
  const filters: OrderFilters = {
    status: statusFilter,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["orders", statusFilter, startDate, endDate],
    queryFn: () => listOrders(filters),
  });

  const clearFilters = () => {
    setStatusFilter(undefined);
    setPeriodPreset(null);
    setStartDate("");
    setEndDate("");
  };

  const selectPeriod = (preset: Exclude<PeriodPreset, null>) => {
    const range = presetRange(preset);
    setPeriodPreset(preset);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: undefined, label: copy.orderList.allStatuses },
    { value: "completed", label: copy.orderList.filterCompleted },
    { value: "voided", label: copy.orderList.filterVoided },
  ];

  const sortedItems = useMemo(() => {
    if (!data) return [];
    return [...data.items].sort((a, b) => {
      if (sortOrder === "created_asc") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortOrder === "amount_desc") return Number(b.total_amount) - Number(a.total_amount);
      if (sortOrder === "amount_asc") return Number(a.total_amount) - Number(b.total_amount);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data, sortOrder]);

  if (isPending) {
    return (
      <ViewLayout width="focused">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-12 w-full mb-4" />
        <Card>
          <CardContent className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  if (isError) {
    return (
      <ViewLayout width="focused">
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 p-6">
            <AlertCircle className="h-8 w-8 text-destructive shrink-0" />
            <div>
              <p className="font-medium">{copy.orderList.loadError}</p>
              <p className="text-sm text-muted-foreground">{copy.orderList.connectionHint}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => void refetch()}
              className="ml-auto"
            >
              {copy.orderList.retry}
            </Button>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  return (
    <ViewLayout width="wide" className="animate-fade-in">
      <div className="mb-6">
        <ViewHeader
          title={copy.orderList.title}
          meta={`${data?.total ?? 0} ${copy.orderList.total}`}
        />
      </div>

      {/* Filter bar */}
      <div
        className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        aria-label={copy.orderList.filterLabel}
      >
        <div className="inline-flex self-start rounded-kova-md bg-kova-mist p-1">
          {([
            ["today", "Hoy"],
            ["week", "Semana"],
            ["month", "Mes"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={periodPreset === value}
              onClick={() => selectPeriod(value)}
              className={cn(
                "h-8 rounded-kova-sm px-3 text-xs font-medium transition-colors",
                periodPreset === value
                  ? "bg-white text-kova-ink shadow-sm"
                  : "text-muted-foreground hover:text-kova-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Status pills */}
        <div className="flex gap-1.5 flex-wrap">
          {statusOptions.map(({ value, label }) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-quick ease-standard",
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
              onChange={(e) => { setPeriodPreset(null); setStartDate(e.target.value); }}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <Label className="text-xs">{copy.orderList.filterEndDate}</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => { setPeriodPreset(null); setEndDate(e.target.value); }}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1 sm:w-48">
          <Label className="text-xs" htmlFor="orders-sort">
            {copy.orderList.sortLabel}
          </Label>
          <Select
            id="orders-sort"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as OrderSort)}
            aria-label={copy.orderList.sortLabel}
            className="h-9 text-sm"
          >
            <option value="created_desc">{copy.orderList.sortNewest}</option>
            <option value="created_asc">{copy.orderList.sortOldest}</option>
            <option value="amount_desc">{copy.orderList.sortAmountDesc}</option>
            <option value="amount_asc">{copy.orderList.sortAmountAsc}</option>
          </Select>
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
      {sortedItems.length === 0 ? (
        hasActiveFilter ? (
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">{copy.orderList.emptyFiltered}</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-2 text-sm text-primary hover:underline"
              >
                {copy.orderList.clearFilters}
              </button>
            </CardContent>
          </Card>
        ) : (
          <ViewEmpty
            icon={<Inbox className="h-6 w-6" />}
            title={copy.orderList.empty}
            body={copy.orderList.emptyBody}
            primaryCta={{ label: copy.orderList.emptyCta, to: "/register" }}
          />
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="grid gap-3 p-3 sm:hidden">
              {sortedItems.map((order) => (
                <Link
                  key={order.id}
                  to={`/orders/${order.id}`}
                  className="rounded-lg border bg-background p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {new Intl.DateTimeFormat("es-MX", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(order.created_at))}
                      </p>
                      <Badge
                        className="mt-2 gap-1"
                        variant={order.status === "voided" ? "destructive" : "success"}
                      >
                        {order.status === "voided" ? (
                          <Ban className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {order.status === "voided"
                          ? copy.orderList.statusVoided
                          : copy.orderList.statusCompleted}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatMoney(order.total_amount)}</p>
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
                  <tr className="border-b border-kova-border bg-kova-blue/[0.055]">
                    <th scope="col" className="text-left px-4 py-3 font-semibold">{copy.orderList.date}</th>
                    <th scope="col" className="text-left px-4 py-3 font-semibold">{copy.orderList.status}</th>
                    <th scope="col" className="text-right px-4 py-3 font-semibold">{copy.orderList.amount}</th>
                    <th scope="col" className="px-4 py-3 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-kova-border/80 transition-colors last:border-0 hover:bg-kova-mist/55"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDateTime(order.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className="gap-1"
                          variant={order.status === "voided" ? "destructive" : "success"}
                        >
                          {order.status === "voided" ? (
                            <Ban className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {order.status === "voided"
                            ? copy.orderList.statusVoided
                            : copy.orderList.statusCompleted}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
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
    </ViewLayout>
  );
}
