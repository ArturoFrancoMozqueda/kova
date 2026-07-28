// Microinteracciones numéricas de la landing (brief §7): counts ≤400 ms,
// una sola vez por entrada del estado. Con prefers-reduced-motion el valor
// final se muestra directo, sin animación.
import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

export function useCountUp(
  to: number,
  { from, durationMs = 360, delayMs = 0, animate }: { from: number; durationMs?: number; delayMs?: number; animate: boolean },
): number {
  const reduceMotion = usePrefersReducedMotion();
  const shouldAnimate = animate && !reduceMotion;
  const [value, setValue] = useState(shouldAnimate ? from : to);

  useEffect(() => {
    if (!shouldAnimate) {
      setValue(to);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [from, to, durationMs, delayMs, shouldAnimate]);

  return value;
}
