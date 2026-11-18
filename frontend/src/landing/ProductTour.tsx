// A guided tour of the current app, with isolated example data.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { prefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import ProductCapture from "./ProductCapture";
import styles from "./ProductTour.module.css";

export type LandingStoryStepId = "sale" | "inventory" | "cash" | "reports";
export type LandingStoryTrigger = "scroll" | "control";

const t = copy.landing.tour;
const STEP_IDS = t.steps.map((step) => step.id as LandingStoryStepId);

export default function ProductTour({
  primaryTarget,
  onCtaClick,
  onStepView,
}: {
  primaryTarget: string;
  onCtaClick: () => void;
  onStepView: (step: LandingStoryStepId, trigger: LandingStoryTrigger) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tablistRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(prefersReducedMotion());
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      onStepView("sale", "scroll");
      return;
    }
    let tracked = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && (entry.intersectionRatio ?? 1) >= 0.3;
        if (visible && !tracked) {
          tracked = true;
          onStepView("sale", "scroll");
        }
      },
      { threshold: [0, 0.3, 0.6] },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [onStepView]);

  // En móvil las pestañas son un carrusel horizontal: lleva la activa a la
  // vista desplazando solo el carrusel, nunca la página.
  useEffect(() => {
    const list = tablistRef.current;
    const tab = tabRefs.current[active];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const left = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - 16;
    list.scrollTo?.({ left, behavior: reduceMotion ? "auto" : "smooth" });
  }, [active, reduceMotion]);

  const select = useCallback(
    (index: number, focus = false) => {
      setActive(index);
      onStepView(STEP_IDS[index], "control");
      if (focus) tabRefs.current[index]?.focus();
    },
    [onStepView],
  );

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = STEP_IDS.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
          : event.key === "Home" ? 0
            : event.key === "End" ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <section
      id="producto"
      ref={sectionRef}
      className={styles.section}
      aria-labelledby="tour-title"
    >
      <div className={styles.inner}>
        <div className={styles.heading} data-lp-stagger-group>
          <h2 id="tour-title" className={styles.title} data-lp-stagger-item>{t.title}</h2>
          <p className={styles.lead} data-lp-stagger-item>{t.body}</p>
        </div>

        <div className={styles.layout}>
          <div className={styles.rail}>
            <div ref={tablistRef} role="tablist" aria-label={t.tablistLabel} className={styles.tabs}>
              {t.steps.map((step, index) => {
                const selected = index === active;
                return (
                  <button
                    key={step.id}
                    ref={(node) => { tabRefs.current[index] = node; }}
                    type="button"
                    role="tab"
                    id={`tour-tab-${step.id}`}
                    aria-selected={selected}
                    aria-controls={`tour-panel-${step.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={styles.tab}
                    onClick={() => select(index)}
                    onKeyDown={(event) => onTabKey(event, index)}
                  >
                    <span className={styles.tabIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.tabText}>
                      <strong>{step.title}</strong>
                      <span>{step.line}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.stage} data-lp-reveal-opt data-lp-reveal-variant="frame">
            <div className={styles.window}>
              {t.steps.map((step, index) => (
                <div
                  key={step.id}
                  role="tabpanel"
                  id={`tour-panel-${step.id}`}
                  aria-labelledby={`tour-tab-${step.id}`}
                  hidden={index !== active}
                  className={styles.panel}
                >
                  {index === active ? (
                    <div key={`scene-${active}`} className={styles.sceneWrap}>
                      <ProductCapture
                        screen={step.id === "sale" ? "register" : step.id === "cash" ? "shifts" : step.id === "inventory" ? "inventory" : "reports"}
                        alt={step.alt}
                        className={styles.capture}
                      />
                      <p className={styles.result}>{step.result}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <Link to={primaryTarget} className={styles.cta} onClick={onCtaClick}>
            {t.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}
