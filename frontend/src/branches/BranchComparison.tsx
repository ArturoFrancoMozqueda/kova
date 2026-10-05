import { useEffect, useState } from "react";
import { useAuth } from "@/auth/useAuth";
import { getActiveBranchId } from "./activeBranch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/orders/format";
import { compareBranches, type BranchComparison as Comparison } from "./api";

export function BranchComparison({
  startDate,
  endDate,
  refreshKey = 0,
}: {
  startDate: string;
  endDate: string;
  refreshKey?: number;
}) {
  const { state: auth } = useAuth();
  const identityKey =
    auth.status === "authenticated"
      ? JSON.stringify([
          auth.tenantId,
          auth.user.id,
          getActiveBranchId(auth.tenantId, auth.user.id),
        ])
      : null;
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [data, setData] = useState<Comparison | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!startDate || !endDate) return;
    let alive = true;
    setStatus("loading");
    setData(null);
    compareBranches(startDate, endDate)
      .then((report) => {
        if (alive) {
          setData(report);
          setLoadedIdentity(identityKey);
          setStatus("loaded");
        }
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [startDate, endDate, attempt, identityKey, refreshKey]);
  if (!startDate || !endDate) return null;
  const visibleData = loadedIdentity === identityKey ? data : null;
  const leaders =
    visibleData?.branches.filter((branch) =>
      visibleData.leader_branch_ids.includes(branch.branch_id),
    ) ?? [];
  const hasSales = visibleData?.branches.some(
    (branch) => branch.completed_orders > 0,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>¿Qué sucursal vende más?</CardTitle>
        <p className="text-sm text-muted-foreground">
          Todas tus sucursales en el periodo seleccionado. Ventas netas después
          de devoluciones; las cancelaciones quedan fuera.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {status === "loading" ? (
          <p role="status">Comparando sucursales…</p>
        ) : null}
        {status === "error" ? (
          <div role="alert">
            <p>No pudimos comparar las sucursales.</p>
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Volver a comparar
            </Button>
          </div>
        ) : null}
        {status === "loaded" && visibleData ? (
          <>
            {!hasSales ? (
              <p>
                Aún no hay ventas en estas fechas. Registra ventas en cada
                sucursal para comparar sus resultados.
              </p>
            ) : (
              <div className="rounded-lg bg-muted p-4">
                <p className="break-words font-medium">
                  {leaders.length > 1
                    ? `Hay un empate entre ${leaders.map((branch) => branch.branch_name).join(", ")}.`
                    : `${leaders[0]?.branch_name} tiene las mayores ventas netas.`}
                </p>
                <p className="mt-1 text-sm">
                  Total del negocio: {formatMoney(visibleData.total_net_sales)}
                </p>
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              {visibleData.branches.map((branch) => (
                <section
                  key={branch.branch_id}
                  aria-label={`Resultados de ${branch.branch_name}`}
                  className="min-w-0 rounded-lg border p-4"
                >
                  <h3 className="break-words font-semibold">{branch.branch_name}</h3>
                  <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Ventas netas</dt>
                      <dd className="text-lg font-semibold tabular-nums">
                        {formatMoney(branch.net_sales)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Participación</dt>
                      <dd>
                        {Number(branch.share_pct).toLocaleString("es-MX", {
                          maximumFractionDigits: 2,
                        })}
                        % del negocio
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Tickets</dt>
                      <dd>{branch.completed_orders}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Ticket promedio neto
                      </dt>
                      <dd>{formatMoney(branch.average_ticket)}</dd>
                    </div>
                  </dl>
                  <h4 className="mb-2 text-sm font-medium">
                    ¿Qué productos se venden aquí?
                  </h4>
                  {branch.products.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sin ventas en este periodo.
                    </p>
                  ) : (
                    <details open={branch.products.length <= 5}>
                      <summary className="min-h-11 cursor-pointer text-sm">
                        Ver {branch.products.length} productos, ordenados por
                        venta neta
                      </summary>
                      <ul className="divide-y">
                        {branch.products.map((product) => (
                          <li
                            key={`${product.product_id}:${product.product_name}`}
                            className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                          >
                            <span className="min-w-0 break-words">
                              {product.product_name}
                              <span className="block text-xs text-muted-foreground">
                                {product.net_quantity} unidades netas
                              </span>
                            </span>
                            <span className="tabular-nums">
                              {formatMoney(product.net_sales)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
