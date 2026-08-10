// Conductor de escenas del showcase cinemático: una máquina de estados mínima
// (setInterval fijo + remount por key) en vez de un timeline CSS puro, porque
// los previews en vivo solo re-disparan sus animaciones de entrada (count-ups,
// pops, barras) al remontarse. Determinista por loop: sceneMs fijo, sin
// aleatoriedad — cada vuelta de 30s es visualmente idéntica (suficiente para
// la ruta de grabación /kova-showcase-video).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

/** IntersectionObserver continuo (re-arma al salir), a diferencia de los
 *  observadores one-shot: el director pausa fuera de viewport y reinicia
 *  limpio al volver. */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { threshold = 0.35, disabled = false }: { threshold?: number; disabled?: boolean } = {},
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (disabled) {
      setInView(true);
      return;
    }
    const target = ref.current;
    if (!target) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // `intersectionRatio` is capped at viewportHeight / elementHeight, so
          // a target taller than ~1/threshold viewports could never satisfy the
          // ratio and the director would stay paused on a visible section.
          // Treat "fills half the viewport" as in-view too.
          const coversViewport =
            entry.intersectionRect.height >=
            (entry.rootBounds?.height ?? window.innerHeight) * 0.5;
          setInView(
            entry.isIntersecting && (entry.intersectionRatio >= threshold || coversViewport),
          );
        });
      },
      { threshold: [0, threshold] },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [ref, threshold, disabled]);

  return inView;
}

export type ShowcaseDirector = {
  /** Escena activa, 0-indexed. */
  scene: number;
  /** Aumenta al completar un loop y al pausar/reanudar; va en las keys de
   *  remount para que la escena activa re-dispare su animación de entrada. */
  cycle: number;
  /** true cuando el loop está corriendo (en viewport, sin reduced-motion). */
  playing: boolean;
  selectScene: (scene: number) => void;
};

export function useShowcaseDirector({
  sceneCount,
  sceneMs = 6000,
  inView,
  forceMotion = false,
  paused = false,
}: {
  sceneCount: number;
  sceneMs?: number;
  inView: boolean;
  forceMotion?: boolean;
  paused?: boolean;
}): ShowcaseDirector {
  const prefersReducedMotion = usePrefersReducedMotion();
  const playing = forceMotion || (!prefersReducedMotion && inView && !paused);
  const [{ scene, cycle }, setState] = useState({ scene: 0, cycle: 0 });
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      // Reset limpio: al re-entrar arranca en la escena 1 con cycle nuevo,
      // así el preview se remonta y re-anima (y no hay saltos a mitad de
      // escena ni artefactos de intervals throttleados en background).
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setState(({ scene: current, cycle: c }) => {
        const next = (current + 1) % sceneCount;
        return { scene: next, cycle: next === 0 ? c + 1 : c };
      });
    }, sceneMs);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, sceneMs, sceneCount]);

  const selectScene = useCallback((nextScene: number) => {
    // Stop the active tick synchronously. Waiting for the paused prop to
    // re-render leaves a narrow window where the previous interval can undo
    // a visitor's manual selection.
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((current) => ({ scene: nextScene, cycle: current.cycle + 1 }));
  }, []);

  return { scene, cycle, playing, selectScene };
}
