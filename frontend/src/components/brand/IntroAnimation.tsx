import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./IntroAnimation.module.css";

export type IntroAnimationTone = "dark" | "light";

export type IntroAnimationProps = {
  onComplete?: () => void;
  skippable?: boolean;
  showLabels?: boolean;
  showWordmark?: boolean;
  showBadge?: boolean;
  tone?: IntroAnimationTone;
  forceReducedMotion?: boolean;
  className?: string;
};

const COMPLETE_MS = 4500;
const SKIP_VISIBLE_MS = 1000;

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export default function IntroAnimation({
  onComplete,
  skippable = true,
  showLabels = true,
  showWordmark = true,
  showBadge = true,
  tone = "dark",
  forceReducedMotion = false,
  className,
}: IntroAnimationProps) {
  const systemReduced = useSystemReducedMotion();
  const reduced = forceReducedMotion || systemReduced;
  const [skipVisible, setSkipVisible] = useState(false);

  useEffect(() => {
    if (reduced) {
      onComplete?.();
      return;
    }
    const skipT = window.setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_MS);
    const completeT = window.setTimeout(() => onComplete?.(), COMPLETE_MS);
    return () => {
      window.clearTimeout(skipT);
      window.clearTimeout(completeT);
    };
  }, [onComplete, reduced]);

  return (
    <div
      className={cn(styles.stage, tone === "dark" ? styles.toneDark : styles.toneLight, className)}
      data-tone={tone}
      data-reduced-motion={reduced ? "true" : undefined}
    >
      <div className={styles.bgGrid} data-anim />
      <div className={styles.radial} data-anim />

      {skippable ? (
        <button
          type="button"
          onClick={() => onComplete?.()}
          className={cn(styles.skip, skipVisible && styles.skipVisible)}
          aria-label="Saltar animación"
        >
          Saltar
        </button>
      ) : null}

      <div className={styles.composition}>
        <div className={styles.svgWrap}>
          <svg viewBox="0 0 64 64" aria-hidden focusable="false">
            {showLabels ? (
              <g className={styles.labels} data-anim>
                <text className={cn(styles.label, styles.labelBusiness)} data-anim x={32} y={3} textAnchor="middle">Negocio</text>
                <text className={cn(styles.label, styles.labelCustomer)} data-anim x={54} y={47} textAnchor="start">Cliente</text>
                <text className={cn(styles.label, styles.labelMoney)} data-anim x={10} y={47} textAnchor="end">Dinero</text>
              </g>
            ) : null}

            <path className={cn(styles.arc, styles.arc1)} data-anim d="M 32 8 A 52 52 0 0 1 52.78 44" pathLength={100} strokeLinecap="round" strokeWidth={1.8} />
            <path className={cn(styles.arc, styles.arc2)} data-anim d="M 52.78 44 A 52 52 0 0 1 11.22 44" pathLength={100} strokeLinecap="round" strokeWidth={1.8} />
            <path className={cn(styles.arc, styles.arc3)} data-anim d="M 11.22 44 A 52 52 0 0 1 32 8" pathLength={100} strokeLinecap="round" strokeWidth={1.8} />

            <circle className={cn(styles.flowParticle, styles.flow1)} data-anim="flow" r={1.5} />
            <circle className={cn(styles.flowParticle, styles.flow2)} data-anim="flow" r={1.5} />
            <circle className={cn(styles.flowParticle, styles.flow3)} data-anim="flow" r={1.5} />

            <circle className={cn(styles.node, styles.nodeBusiness)} data-anim cx={32} cy={8} r={5} />
            <circle className={cn(styles.node, styles.nodeCustomer)} data-anim cx={52.78} cy={44} r={5} />
            <circle className={cn(styles.node, styles.nodeMoney)} data-anim cx={11.22} cy={44} r={5} />

            <circle className={styles.core} data-anim cx={32} cy={32} r={5} />
          </svg>
        </div>

        <div className={styles.textBlock}>
          {showWordmark ? (
            <>
              <h1 className={styles.wordmark} data-anim>
                kova<span className={styles.wordmarkDot}>.</span>
              </h1>
              <p className={styles.tagline} data-anim>
                Tu negocio, en flujo constante.
              </p>
            </>
          ) : null}
          {showBadge ? (
            <div className={styles.badge} data-anim>
              <span className={styles.badgeDot} />
              <span className={styles.badgeText}>Punto de venta para México</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
