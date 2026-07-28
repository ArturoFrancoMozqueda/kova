// Gate de visibilidad de un solo disparo para los `animate` props de los
// previews (useCountUp, data-lp-anim). No es una primitiva de motion nueva:
// sólo decide CUÁNDO arrancan las existentes — al entrar al viewport, una vez.
//
// Mismas opciones de observación que useRevealMotion para que los count-ups
// disparen junto con el reveal visual de la fila. Con prefers-reduced-motion
// devuelve true de inmediato: los previews muestran su estado final estático
// (useCountUp tiene además su propia guarda interna).
import { useEffect, useRef, useState, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/usePrefersReducedMotion";

export function useInViewOnce(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  const seenRef = useRef(false);

  useEffect(() => {
    if (seenRef.current) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      seenRef.current = true;
      setSeen(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        seenRef.current = true;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return seen;
}
