import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export type ChartMetaLine = {
  label: string;
  value: string;
};

export type ChartRow = {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  meta?: ChartMetaLine[];
  accentClassName?: string;
};

type InteractiveChartProps = {
  title: string;
  insight?: string;
  rows: ChartRow[];
  emptyLabel: string;
  ariaLabel: string;
  detailPlaceholder: string;
  totalShareLabel: (pct: number) => string;
};

function getActiveRow(rows: ChartRow[], selectedId: string | null, previewId: string | null) {
  return rows.find((row) => row.id === (selectedId ?? previewId)) ?? null;
}

function percentOfTotal(row: ChartRow, total: number) {
  return total > 0 ? Math.round((row.value / total) * 100) : 0;
}

function ChartDetail({
  row,
  total,
  detailId,
  detailPlaceholder,
  totalShareLabel,
}: {
  row: ChartRow | null;
  total: number;
  detailId: string;
  detailPlaceholder: string;
  totalShareLabel: (pct: number) => string;
}) {
  if (!row) {
    return (
      <div
        id={detailId}
        className="min-h-16 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground"
      >
        {detailPlaceholder}
      </div>
    );
  }

  return (
    <div
      id={detailId}
      className="min-h-16 rounded-lg border bg-background p-3 shadow-sm"
      role="status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{row.label}</p>
        <p className="text-sm font-bold tabular-nums">{row.valueLabel}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{totalShareLabel(percentOfTotal(row, total))}</span>
        {row.meta?.map((item) => (
          <span key={`${item.label}-${item.value}`}>
            {item.label}: {item.value}
          </span>
        ))}
      </div>
    </div>
  );
}

export function InteractiveBarChart({
  title,
  insight,
  rows,
  emptyLabel,
  ariaLabel,
  detailPlaceholder,
  totalShareLabel,
}: InteractiveChartProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const detailId = useId();
  const visibleRows = useMemo(() => rows.filter((row) => row.value > 0), [rows]);
  const max = Math.max(...rows.map((row) => row.value), 1);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const activeRow = getActiveRow(rows, selectedId, previewId);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {insight ? <p className="mt-1 text-sm text-muted-foreground">{insight}</p> : null}
      </div>
      {visibleRows.length === 0 ? (
        <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <>
          <div
            className="flex min-h-52 items-end gap-1 overflow-x-auto rounded-lg border bg-muted/20 p-3"
            aria-label={ariaLabel}
          >
            {rows.map((row) => {
              const isActive = activeRow?.id === row.id;
              const height = row.value > 0 ? Math.max(8, (row.value / max) * 100) : 2;
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-label={`${row.label}: ${row.valueLabel}, ${totalShareLabel(percentOfTotal(row, total))}`}
                  aria-pressed={selectedId === row.id}
                  aria-describedby={isActive ? detailId : undefined}
                  onClick={() => setSelectedId((current) => (current === row.id ? null : row.id))}
                  onFocus={() => setPreviewId(row.id)}
                  onBlur={() => setPreviewId(null)}
                  onMouseEnter={() => setPreviewId(row.id)}
                  onMouseLeave={() => setPreviewId(null)}
                  className="group flex min-w-8 flex-1 flex-col items-center gap-1 rounded-md p-1 outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-36 w-full items-end">
                    <span
                      className={cn(
                        "w-full rounded-t bg-primary transition-all group-hover:bg-primary/80",
                        isActive ? "bg-kova-blue shadow-sm" : row.accentClassName,
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </span>
                  <span className="max-w-12 truncate text-[10px] text-muted-foreground tabular-nums">
                    {row.label}
                  </span>
                </button>
              );
            })}
          </div>
          <ChartDetail
            row={activeRow}
            total={total}
            detailId={detailId}
            detailPlaceholder={detailPlaceholder}
            totalShareLabel={totalShareLabel}
          />
        </>
      )}
    </div>
  );
}

export function InteractiveRankChart({
  title,
  insight,
  rows,
  emptyLabel,
  ariaLabel,
  detailPlaceholder,
  totalShareLabel,
}: InteractiveChartProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const detailId = useId();
  const visibleRows = useMemo(() => rows.filter((row) => row.value > 0), [rows]);
  const max = Math.max(...rows.map((row) => row.value), 1);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const activeRow = getActiveRow(rows, selectedId, previewId);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {insight ? <p className="mt-1 text-sm text-muted-foreground">{insight}</p> : null}
      </div>
      {visibleRows.length === 0 ? (
        <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <>
          <div className="space-y-2" aria-label={ariaLabel}>
            {rows.map((row, index) => {
              const isActive = activeRow?.id === row.id;
              const width = row.value > 0 ? Math.max(4, (row.value / max) * 100) : 0;
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-label={`${row.label}: ${row.valueLabel}, ${totalShareLabel(percentOfTotal(row, total))}`}
                  aria-pressed={selectedId === row.id}
                  aria-describedby={isActive ? detailId : undefined}
                  onClick={() => setSelectedId((current) => (current === row.id ? null : row.id))}
                  onFocus={() => setPreviewId(row.id)}
                  onBlur={() => setPreviewId(null)}
                  onMouseEnter={() => setPreviewId(row.id)}
                  onMouseLeave={() => setPreviewId(null)}
                  className={cn(
                    "w-full rounded-lg border bg-background p-3 text-left outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring",
                    isActive ? "border-primary shadow-sm" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="truncate font-medium">{row.label}</span>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{row.valueLabel}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div
                      className={cn("h-2 rounded-full bg-primary", row.accentClassName)}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
          <ChartDetail
            row={activeRow}
            total={total}
            detailId={detailId}
            detailPlaceholder={detailPlaceholder}
            totalShareLabel={totalShareLabel}
          />
        </>
      )}
    </div>
  );
}
