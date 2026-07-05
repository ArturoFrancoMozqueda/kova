// Report-specific formatters. Money for prose/tooltips/tiles uses `formatMoney`
// from `@/orders/format` (es-MX / MXN). These helpers cover the two cases that
// module does not: compact axis ticks and signed-percentage labels.

/**
 * Compact currency for chart axis ticks, where full `$1,500.00` labels overlap.
 * es-MX groups thousands with commas, so `$1,500` reads cleanly and only values
 * ≥ 10k collapse to `$12.5k` / `$1.2M`. Always prefixed with `$`, never negative
 * (axes start at 0).
 */
export function formatCompactMoney(value: number): string {
  const n = Math.round(value);
  if (n >= 1_000_000) {
    return `$${trimZero(n / 1_000_000)}M`;
  }
  if (n >= 10_000) {
    return `$${trimZero(n / 1_000)}k`;
  }
  return `$${n.toLocaleString("es-MX")}`;
}

function trimZero(value: number): string {
  // One decimal, but drop a trailing ".0" so "$12k" instead of "$12.0k".
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * Signed integer percentage label. `<1%` collapses to "<1%" (matching the
 * dashboard DeltaBadge convention) so tiny movements don't read as "0%".
 */
export function formatSignedPercent(pct: number): string {
  const abs = Math.abs(pct);
  const magnitude = abs < 1 && abs > 0 ? "<1" : String(Math.round(abs));
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${magnitude}%`;
}

/** Plain percentage label (no sign), for share-of-total values. */
export function formatPercent(pct: number): string {
  return `${Math.round(pct)}%`;
}
