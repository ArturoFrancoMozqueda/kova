// Reveal — the shared scroll-entrance primitive for Kova (landing + in-app).
//
// Design goals, in order of importance:
//  1. SSR-safe. The landing is prerendered (scripts/prerender.mjs renders
//     <Home/> to static HTML). Content MUST be visible in that HTML and to
//     no-JS clients, so the reveal only arms AFTER hydration — mirroring the
//     old `lp-motion-ready` gate it replaces. We never bake opacity:0 into SSR.
//  2. Reduced-motion + jsdom safe. If the user prefers reduced motion, or the
//     runtime has no IntersectionObserver (jsdom, very old browsers), the
//     element renders at its final visible state and never animates.
//  3. No remount. A single motion element is rendered in every state; we drive
//     it via `animate` so heavy children (charts, count-ups) are never torn
//     down when the reveal arms.
//
// Motion matches the previous CSS system: fade + 18px lift + 3px deblur over
// 640ms on the --kova-ease-entrance curve (cubic-bezier(0.16,1,0.3,1)).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  m,
  useInView,
  useReducedMotion,
  type TargetAndTransition,
  type Transition,
} from "motion/react";

/** --kova-ease-entrance, as a Framer cubic-bezier array. */
export const KOVA_EASE_ENTRANCE = [0.16, 1, 0.3, 1] as const;
/** --kova-ease-spring. */
export const KOVA_EASE_SPRING = [0.34, 1.56, 0.64, 1] as const;

export type RevealVariants = { hidden: TargetAndTransition; visible: TargetAndTransition };

/** Tags we render as motion elements. Extend as needed. */
type MotionTag = "div" | "section" | "li" | "ol" | "ul" | "span" | "footer" | "article" | "hr";

export type RevealProps = {
  children?: ReactNode;
  /** Element tag. Defaults to "div". */
  as?: MotionTag;
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Entrance delay in seconds. Use for staggering sibling reveals. */
  delay?: number;
  /** Lift distance in px (hidden → visible). Landing uses 18; in-app uses ~12. */
  y?: number;
  /** Whether to deblur on entrance. On for the landing's premium feel; off in-app. */
  blur?: boolean;
  /** Reveal only once (default) or every time it re-enters the viewport. */
  once?: boolean;
  /** Fraction of the element that must be visible to trigger. */
  amount?: number;
  /** Viewport root margin passed to the underlying IntersectionObserver. */
  margin?: string;
  /** Override the hidden/visible variants entirely (e.g. the ticket-print effect). */
  variants?: RevealVariants;
  /** Override the visible-transition (delay is merged in automatically). */
  transition?: Transition;
};

function buildVariants(y: number, blur: boolean): RevealVariants {
  return {
    hidden: { opacity: 0, y, ...(blur ? { filter: "blur(3px)" } : {}) },
    visible: { opacity: 1, y: 0, ...(blur ? { filter: "blur(0px)" } : {}) },
  };
}

export function Reveal({
  children,
  as = "div",
  id,
  className,
  style,
  delay = 0,
  y = 18,
  blur = true,
  once = true,
  amount = 0.12,
  margin = "0px 0px -10% 0px",
  variants,
  transition,
}: RevealProps): ReactNode {
  const ref = useRef<HTMLElement | null>(null);
  const prefersReduced = useReducedMotion();

  // Armed only after mount, and only when motion is allowed and observable.
  // Until then the element renders at its visible state (SSR + first paint +
  // reduced-motion + no-IntersectionObserver all fall here).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (prefersReduced) return;
    if (!("IntersectionObserver" in window)) return;
    setArmed(true);
  }, [prefersReduced]);

  const inView = useInView(ref, {
    once,
    amount,
    // Framer's margin type is a branded string; the value is a valid CSS margin.
    margin: margin as Parameters<typeof useInView>[1] extends { margin?: infer M } ? M : never,
  });

  const resolved = variants ?? buildVariants(y, blur);
  // Visible on the server / first render / reduced-motion / no-IO, and once in
  // view. When armed-but-not-yet-in-view we hide with a zero-duration jump so
  // below-the-fold content never visibly fades OUT before its entrance.
  const target = !armed || inView ? "visible" : "hidden";
  const visibleTransition: Transition = transition
    ? { ...transition, delay }
    : { duration: 0.64, ease: KOVA_EASE_ENTRANCE, delay };

  const MotionTag = m[as];
  return (
    <MotionTag
      ref={ref as never}
      id={id}
      className={className}
      style={style}
      variants={resolved}
      initial={false}
      animate={target}
      transition={target === "hidden" ? { duration: 0 } : visibleTransition}
    >
      {children}
    </MotionTag>
  );
}

export default Reveal;
