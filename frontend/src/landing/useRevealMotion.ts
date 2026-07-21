// Reveal-on-scroll para la landing. Extraído de routes/Home.tsx para que otras
// secciones (p. ej. landing/SaleStory.tsx) reusen el mismo mecanismo.
//
// Determinismo de prerender: el hook SOLO corre post-hidratación (useEffect).
// El HTML prerenderizado y el primer render de cliente NO llevan data-lp-reveal
// ni .lp-motion-ready, así que el CSS que oculta contenido
// (.lp-root.lp-motion-ready [data-lp-reveal]) nunca aplica sin JS: todo el
// contenido queda visible. Respeta prefers-reduced-motion mostrando todo de
// inmediato.
//
// Tres formas de participar:
//  1. Clases legacy (.lp-reveal-block, .lp-benefit-strip, .lp-story-card,
//     .lp-footer-grid, .lp-ticket-print) — cada elemento revela individualmente,
//     con el stagger histórico (index % 3 * 80ms). Comportamiento intacto.
//  2. [data-lp-reveal-opt] — opt-in por atributo para secciones nuevas; combina
//     con data-lp-reveal-variant ("rise" | "rise-lg" | "frame") en el CSS.
//  3. [data-lp-stagger-group] — el grupo es la unidad observada; sus hijos
//     [data-lp-stagger-item] revelan escalonados (80ms, tope 4 pasos) cuando el
//     grupo entra al viewport, estableciendo jerarquía entre elementos ligados.
import { useEffect } from "react";

const LEGACY_SELECTOR = [
  ".lp-reveal-block",
  ".lp-benefit-strip",
  ".lp-story-card",
  ".lp-footer-grid",
  // Recibo de precio: mismas data-attrs, pero su CSS imprime las líneas en
  // orden en vez del fade genérico (lp-tkt-print).
  ".lp-ticket-print",
].join(",");

const STAGGER_STEP_MS = 80;
const STAGGER_MAX_STEPS = 4;

type RevealUnit = { trigger: HTMLElement; targets: HTMLElement[] };

export function useLandingRevealMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp-root");
    if (!root) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const seen = new Set<HTMLElement>();
    const units: RevealUnit[] = [];

    const markReveal = (el: HTMLElement, delayMs: number) => {
      el.dataset.lpReveal = "true";
      el.style.setProperty("--lp-reveal-delay", `${delayMs}ms`);
    };

    // 1. Reveals individuales legacy — stagger histórico (index % 3 * 80ms).
    Array.from(root.querySelectorAll<HTMLElement>(LEGACY_SELECTOR)).forEach(
      (target, index) => {
        if (seen.has(target)) return;
        seen.add(target);
        markReveal(target, Math.min(index % 3, 2) * STAGGER_STEP_MS);
        units.push({ trigger: target, targets: [target] });
      },
    );

    // 2. Reveals individuales opt-in (secciones nuevas), sin stagger propio.
    Array.from(root.querySelectorAll<HTMLElement>("[data-lp-reveal-opt]")).forEach(
      (target) => {
        if (seen.has(target)) return;
        seen.add(target);
        markReveal(target, 0);
        units.push({ trigger: target, targets: [target] });
      },
    );

    // 3. Grupos escalonados — el grupo dispara, los hijos revelan en cascada.
    Array.from(
      root.querySelectorAll<HTMLElement>("[data-lp-stagger-group]"),
    ).forEach((group) => {
      const items = Array.from(
        group.querySelectorAll<HTMLElement>("[data-lp-stagger-item]"),
      ).filter((item) => !seen.has(item));
      if (items.length === 0) return;
      items.forEach((item, index) => {
        seen.add(item);
        markReveal(item, Math.min(index, STAGGER_MAX_STEPS - 1) * STAGGER_STEP_MS);
      });
      units.push({ trigger: group, targets: items });
    });

    root.classList.add("lp-motion-ready");

    const revealUnit = (unit: RevealUnit) => {
      unit.targets.forEach((target) => {
        target.dataset.lpVisible = "true";
      });
    };

    const cleanup = () => {
      root.classList.remove("lp-motion-ready");
      seen.forEach((target) => {
        target.removeAttribute("data-lp-reveal");
        target.removeAttribute("data-lp-visible");
        target.style.removeProperty("--lp-reveal-delay");
      });
    };

    if (reduceMotion || !("IntersectionObserver" in window)) {
      units.forEach(revealUnit);
      return cleanup;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const unit = units.find((candidate) => candidate.trigger === entry.target);
          if (unit) revealUnit(unit);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );

    units.forEach((unit) => observer.observe(unit.trigger));

    return () => {
      observer.disconnect();
      cleanup();
    };
  }, []);
}
