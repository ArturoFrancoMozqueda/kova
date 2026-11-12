import { Skeleton } from "@/components/ui/skeleton";

const panel = "min-w-0 rounded-kova-xl border border-kova-border bg-white p-4 sm:p-5";

/** Reserve the overview's reading order without presenting unconfirmed data. */
export function DashboardSkeleton({ scopePending, branchCount = 2 }: {
  scopePending: boolean;
  branchCount?: number;
}) {
  return (
    <div role="status" aria-label="Cargando centro de control" aria-busy="true">
      <span className="sr-only">Cargando centro de control</span>
      <div aria-hidden="true">
        {scopePending && <div className="my-4 flex min-h-16 items-center justify-between gap-4 rounded-kova-xl border border-kova-border bg-white px-4">
          <Skeleton className="h-11 w-64 max-w-[70%]" />
          <Skeleton className="h-4 w-28 max-w-[20%]" />
        </div>}
        <div className="mb-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {["Ventas netas", "Órdenes", "Ticket promedio", "Turnos abiertos"].map((label, index) => (
              <div key={label} className={`min-w-0 rounded-kova-xl border p-3 sm:p-5 ${index === 0 ? "border-kova-ink bg-kova-ink text-white" : "border-kova-border bg-white"}`}>
                <p className={`text-xs font-medium ${index === 0 ? "text-white/80" : "text-kova-muted"}`}>{label}</p>
                <Skeleton className={`mt-3 h-7 w-3/4 sm:h-9 ${index === 0 ? "bg-white/15" : ""}`} />
                <Skeleton className={`mt-2 h-4 w-full ${index === 0 ? "bg-white/15" : ""}`} />
              </div>
            ))}
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
            <div className={panel}>
              <h2 className="font-semibold">Ritmo de ventas</h2>
              <Skeleton className="mt-2 h-3 w-36" />
              <Skeleton className="my-4 h-44 w-full sm:h-56" />
              <div className="flex min-h-14 items-center justify-between gap-3 border-t border-kova-border pt-2">
                <Skeleton className="h-3 w-24" /><Skeleton className="h-11 w-32" />
              </div>
            </div>
            <div className={panel}>
              <h2 className="font-semibold">Necesita tu atención</h2>
              <Skeleton className="mb-3 mt-4 h-1.5 w-full" />
              {[0, 1, 2].map(row => <div key={row} className="flex min-h-16 items-center gap-3 border-b border-kova-border py-3">
                <Skeleton className="h-9 w-9 shrink-0" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-5/6" /><Skeleton className="h-3 w-2/3" /></div>
              </div>)}
              <Skeleton className="mt-4 h-3 w-5/6" />
            </div>
          </div>
        </div>
        <div className={`mb-5 ${panel}`}>
          <h2 className="mb-4 font-semibold">Resultados por sucursal</h2>
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {Array.from({ length: branchCount }, (_, index) => <div key={index} className="space-y-3 py-3">
              <div className="flex justify-between gap-4"><Skeleton className="h-4 w-40 max-w-[65%]" /><Skeleton className="h-4 w-20" /></div>
              <Skeleton className="h-2.5 w-full rounded-full" />
              <Skeleton className="h-3 w-36" /><Skeleton className="h-11 w-44 max-w-full" />
            </div>)}
          </div>
        </div>
        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          {["Productos más vendidos", "Horas con más venta", "Cómo te pagaron"].map(title => <div key={title} className={panel}>
            <h2 className="mb-4 flex min-h-11 items-center font-semibold">{title}</h2>
            {title === "Cómo te pagaron" ? <div className="flex min-h-40 items-center gap-5">
              <Skeleton className="h-28 w-28 shrink-0 rounded-full" />
              <div className="flex-1 space-y-4">{[0, 1, 2].map(row => <Skeleton key={row} className="h-3 w-full" />)}</div>
            </div> : <div className="space-y-4">{[0, 1, 2].map(row => <div key={row} className="space-y-2">
              <div className="flex justify-between gap-3"><Skeleton className="h-4 w-3/5" /><Skeleton className="h-4 w-16" /></div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>)}</div>}
          </div>)}
        </div>
      </div>
    </div>
  );
}
