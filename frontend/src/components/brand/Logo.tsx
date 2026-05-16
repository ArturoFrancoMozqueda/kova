import { cn } from "@/lib/utils";

export type LogoVariant = "isotipo" | "horizontal";

type LogoProps = {
  variant?: LogoVariant;
  size?: number;
  className?: string;
  title?: string;
  /** Color of the outer circuit (nodes + arcs). Defaults to currentColor. */
  circuitColor?: string;
  /** Color of the central core. Defaults to var(--kova-blue). */
  coreColor?: string;
  /** Color of the wordmark in the horizontal variant. Defaults to currentColor. */
  wordmarkColor?: string;
};

const NODES = [
  { x: 32, y: 8 },
  { x: 52.78, y: 44 },
  { x: 11.22, y: 44 },
] as const;

const ARC_RADIUS = 32;

function arcPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  return `M ${from.x} ${from.y} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${to.x} ${to.y}`;
}

export function LogoMark({
  size = 32,
  className,
  title,
  circuitColor,
  coreColor,
}: Omit<LogoProps, "variant" | "wordmarkColor">) {
  const titled = Boolean(title);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={titled ? "img" : undefined}
      aria-label={titled ? title : undefined}
      aria-hidden={titled ? undefined : true}
      className={className}
    >
      {titled ? <title>{title}</title> : null}

      {NODES.map((from, i) => {
        const to = NODES[(i + 1) % NODES.length];
        return (
          <path
            key={`arc-${i}`}
            d={arcPath(from, to)}
            stroke={circuitColor ?? "currentColor"}
            strokeWidth={2.4}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}

      {NODES.map((n, i) => (
        <circle
          key={`node-${i}`}
          cx={n.x}
          cy={n.y}
          r={3.2}
          fill={circuitColor ?? "currentColor"}
        />
      ))}

      <circle cx={32} cy={32} r={6} fill={coreColor ?? "var(--kova-blue)"} />
      <circle cx={32} cy={32} r={2} fill="#FFFFFF" />
    </svg>
  );
}

export default function Logo({
  variant = "horizontal",
  size = 28,
  className,
  title = "kova",
  circuitColor,
  coreColor,
  wordmarkColor,
}: LogoProps) {
  if (variant === "isotipo") {
    return (
      <LogoMark
        size={size}
        className={className}
        title={title}
        circuitColor={circuitColor}
        coreColor={coreColor}
      />
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark
        size={size}
        title={title}
        circuitColor={circuitColor}
        coreColor={coreColor}
      />
      <span
        className="font-semibold tracking-tight"
        style={{
          color: wordmarkColor,
          fontSize: `${Math.round(size * 0.72)}px`,
          letterSpacing: "-0.02em",
        }}
      >
        kova
      </span>
    </span>
  );
}
