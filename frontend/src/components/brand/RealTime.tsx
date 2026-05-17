import { useEffect, useRef, useState } from "react";

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

  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{format(display)}</span>;
}

type LivePulseProps = {
  label: string;
  className?: string;
};

export function LivePulse({ label, className }: LivePulseProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--kova-growth)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--kova-growth)",
          boxShadow: "0 0 0 0 var(--kova-growth)",
          animation: "kovaLivePulse 1.5s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        }}
      />
      {label}
    </span>
  );
}
