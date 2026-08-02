import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export type WeeklyKpiPoint = {
  id: string;
  label: string;
  fullLabel: string;
  value: number;
  valueLabel: string;
};

/**
 * Project-native adaptation of the 21st.dev Weekly KPI Chart. The catalog
 * component's selectable-day interaction is preserved, while the fixed SVG,
 * demo values and animation dependency are replaced with responsive Kova
 * primitives and real report values supplied by the caller.
 */
export function WeeklyKpiChart({
  data,
  referenceValue = 0,
  referenceLabel,
  className,
}: {
  data: WeeklyKpiPoint[];
  referenceValue?: number;
  referenceLabel?: string;
  className?: string;
}) {
  const bestIndex = useMemo(() => {
    if (data.length === 0) return -1;
    return data.reduce(
      (best, point, index) => (point.value > data[best].value ? index : best),
      0,
    );
  }, [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = selectedId
    ? data.findIndex((point) => point.id === selectedId)
    : bestIndex;
  const ceiling = Math.max(referenceValue, ...data.map((point) => point.value), 1);
  const referenceBottom = Math.min(100, Math.max(0, (referenceValue / ceiling) * 100));
  const minWidth = Math.max(560, data.length * 46);

  return (
    <div className={cn("w-full", className)}>
      <p className="sr-only" aria-live="polite">
        {selectedIndex >= 0
          ? `${data[selectedIndex].fullLabel}: ${data[selectedIndex].valueLabel}`
          : undefined}
      </p>
      <div className="overflow-x-auto pb-1">
        <div className="relative h-48" style={{ minWidth }}>
          {referenceValue > 0 ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-kova-tertiary/70"
              style={{ bottom: `calc(1.75rem + ${referenceBottom * 1.36}px)` }}
              aria-hidden
            />
          ) : null}
          <div
            className="grid h-full items-end gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(36px, 1fr))` }}
          >
            {data.map((point, index) => {
              const isSelected = index === selectedIndex;
              const isStrong = referenceValue > 0 && point.value >= referenceValue;
              const height = point.value > 0 ? Math.max(8, (point.value / ceiling) * 136) : 3;
              return (
                <button
                  key={point.id}
                  type="button"
                  className="group flex h-full min-w-0 flex-col justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2"
                  aria-pressed={isSelected}
                  aria-label={`${point.fullLabel}: ${point.valueLabel}`}
                  onClick={() => setSelectedId(point.id)}
                >
                  <span
                    className={cn(
                      "mb-2 block truncate text-center text-[10px] font-semibold tabular-nums transition-opacity",
                      isSelected ? "opacity-100 text-kova-ink" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    {point.valueLabel}
                  </span>
                  <span
                    className={cn(
                      "block w-full rounded-t-kova-sm transition-colors duration-hover",
                      isSelected || isStrong
                        ? "bg-kova-ink"
                        : point.value > 0
                          ? "bg-kova-blue-light group-hover:bg-kova-tertiary/55"
                          : "bg-kova-border",
                    )}
                    style={{ height }}
                    aria-hidden
                  />
                  <span className="mt-2 truncate text-center text-[11px] text-kova-tertiary">
                    {point.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {referenceValue > 0 && referenceLabel ? (
        <p className="mt-2 border-t border-kova-border/70 pt-3 text-xs tabular-nums text-kova-tertiary">
          {referenceLabel}
        </p>
      ) : null}
    </div>
  );
}
