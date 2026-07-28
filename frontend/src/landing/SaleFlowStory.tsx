import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
import styles from "./SaleFlowStory.module.css";

export type LandingStoryStepId = "sale" | "inventory" | "cash" | "reports";
export type LandingStoryTrigger = "scroll" | "control";

type StoryStep = {
  id: LandingStoryStepId;
  number: string;
  title: string;
  line: string;
  receipt: string;
};

const t = copy.landing.immersiveStory;
const STORY_STEPS = t.steps as readonly StoryStep[];

const STORY_CAPTURES: Record<
  LandingStoryStepId,
  { src: string; screen: string; alt: string }
> = {
  sale: {
    src: "/showcase/register.png",
    screen: "Caja",
    alt: "Caja real de Kova con el catálogo, un carrito de tres productos y un total de $186.",
  },
  inventory: {
    src: "/showcase/inventory.png",
    screen: "Inventario",
    alt: "Inventario real de Kova con una alerta de stock bajo y existencias por producto.",
  },
  cash: {
    src: "/showcase/shifts.png",
    screen: "Turnos",
    alt: "Turnos reales de Kova con efectivo esperado, movimientos y cortes recientes.",
  },
  reports: {
    src: "/showcase/reports.png",
    screen: "Reportes",
    alt: "Reportes reales de Kova con ventas, órdenes, ticket promedio y prioridad operativa.",
  },
};

function StoryCapture({ step }: { step: LandingStoryStepId }) {
  const capture = STORY_CAPTURES[step];
  return (
    <figure className={styles.capture}>
      <img
        src={capture.src}
        alt={capture.alt}
        className={styles.captureImage}
        width={1440}
        height={900}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      <figcaption className={styles.captureCaption}>
        <span>{capture.screen}</span>
        <span>Captura real y sanitizada</span>
      </figcaption>
    </figure>
  );
}

export default function SaleFlowStory({
  primaryTarget,
  onCtaClick,
  onStepView,
}: {
  primaryTarget: string;
  onCtaClick: () => void;
  onStepView: (step: LandingStoryStepId, trigger: LandingStoryTrigger) => void;
}) {
  const [activeStep, setActiveStep] = useState<LandingStoryStepId>("sale");
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    onStepView("sale", "scroll");
  }, [onStepView]);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const step = (visible.target as HTMLElement).dataset.step as LandingStoryStepId;
        setActiveStep(step);
        onStepView(step, "scroll");
      },
      {
        rootMargin: "-28% 0px -36% 0px",
        threshold: [0.1, 0.35, 0.6],
      },
    );
    stepRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [onStepView]);

  const selectStep = useCallback(
    (step: LandingStoryStepId, index: number) => {
      setActiveStep(step);
      onStepView(step, "control");
      stepRefs.current[index]?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
    },
    [onStepView, reducedMotion],
  );

  return (
    <section id="producto" className={styles.section} aria-labelledby="sale-flow-title">
      <div className={styles.inner}>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>{t.eyebrow}</span>
            <h2 id="sale-flow-title" className={styles.title}>
              {t.title}
            </h2>
          </div>
          <div>
            <p className={styles.lead}>{t.body}</p>
            <p className={styles.problem}>{t.problem}</p>
            <Link to={primaryTarget} className={styles.cta} onClick={onCtaClick}>
              {t.cta}
            </Link>
          </div>
        </div>

        <div className={styles.story}>
          <div className={styles.steps}>
            {STORY_STEPS.map((step, index) => (
              <article
                key={step.id}
                ref={(node) => {
                  stepRefs.current[index] = node;
                }}
                className={styles.step}
                data-step={step.id}
                data-active={activeStep === step.id ? "true" : "false"}
                aria-labelledby={`sale-flow-${step.id}`}
              >
                <div className={styles.stepCopy}>
                  <span className={styles.number}>{step.number}</span>
                  <h3 id={`sale-flow-${step.id}`} className={styles.stepTitle}>
                    {step.title}
                  </h3>
                  <p className={styles.stepLine}>{step.line}</p>
                  <span className={styles.receiptStub}>{step.receipt}</span>
                </div>
                <div className={`${styles.mobilePreview} lp-story-card`}>
                  <StoryCapture step={step.id} />
                </div>
              </article>
            ))}
          </div>

          <aside className={styles.stage} aria-label={t.productLabel}>
            <div className={styles.stageShell}>
              <div className={styles.stageMeta}>
                <span className={styles.live}>{t.productLabel}</span>
                <span className="tabular">$186 MXN</span>
              </div>
              <div className={styles.controls} aria-label={t.progressLabel}>
                {STORY_STEPS.map((step, index) => (
                  <button
                    key={step.id}
                    type="button"
                    className={styles.control}
                    aria-current={activeStep === step.id ? "step" : undefined}
                    aria-label={`${step.number} ${step.title}`}
                    onClick={() => selectStep(step.id, index)}
                  >
                    {step.number}
                  </button>
                ))}
              </div>
              <div className={styles.panels} aria-live="polite">
                {STORY_STEPS.map((step) => (
                  <div
                    key={step.id}
                    className={styles.panel}
                    data-active={activeStep === step.id ? "true" : "false"}
                    aria-hidden={activeStep !== step.id}
                  >
                    <StoryCapture step={step.id} />
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
