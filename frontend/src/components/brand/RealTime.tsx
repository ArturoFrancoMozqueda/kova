import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

type CountUpProps = {
  value: number;
  duration?: number;
  format: (n: number) => string;
  className?: string;
};

export function CountUp({ value, duration = 600, format, className }: CountUpProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (reducedMotion.current) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * EASE_OUT(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={cn("tabular-nums", className)}>{format(display)}</span>;
}

type LivePulseProps = {
  label: string;
  className?: string;
};

export function LivePulse({ label, className }: LivePulseProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-kova-growth",
        className,
      )}
    >
      <span aria-hidden className="kova-live-pulse-dot h-2 w-2 rounded-full bg-kova-growth" />
      {label}
    </span>
  );
}
