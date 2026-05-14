import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { listOrders } from "./api";
import { formatMoney } from "./format";
import type { OrderListItem } from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, AlertCircle, Inbox } from "lucide-react";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; items: OrderListItem[]; total: number };

export default function OrderListView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const result = await listOrders();
      setLoadState({ status: "loaded", items: result.items, total: result.total });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.status === "loading") {
    return (
      <main className="p-6 lg:p-8 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
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
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="font-medium">{copy.orderList.loadError}</p>
            </div>
            <Button variant="outline" onClick={() => void load()} className="ml-auto">
              {copy.orderList.retry}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.orderList.title}</h1>
          <p className="text-sm text-muted-foreground">{loadState.total} {copy.orderList.total}</p>
        </div>
      </div>

      {loadState.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{copy.orderList.empty}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-semibold">{copy.orderList.date}</th>
                    <th className="text-left px-4 py-3 font-semibold">{copy.orderList.status}</th>
                    <th className="text-right px-4 py-3 font-semibold">{copy.orderList.amount}</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {loadState.items.map((order) => (
                    <tr key={order.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={order.status === "voided" ? "destructive" : "success"}>
                          {order.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatMoney(order.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/orders/${order.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
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
