import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
  heading: string;
  image: string;
  alt: string;
};

const t = copy.landing.immersiveStory;
const STORY_STEPS = t.steps as readonly StoryStep[];
const STORY_CAPTURE_ASSETS: Record<
  LandingStoryStepId,
  {
    width: number;
    height: number;
    mobileImage: string;
  }
> = {
  sale: {
    width: 3196,
    height: 1795,
    mobileImage: "/showcase/sale-register-mobile.webp",
  },
  inventory: {
    width: 3196,
    height: 1784,
    mobileImage: "/showcase/inventory-story-mobile.webp",
  },
  cash: {
    width: 1440,
    height: 900,
    mobileImage: "/showcase/shifts-mobile.webp",
  },
  reports: {
    width: 3196,
    height: 1811,
    mobileImage: "/showcase/analysis-story-mobile.webp",
  },
};

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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    onStepView("sale", "scroll");
  }, [onStepView]);

  const selectStep = useCallback(
    (step: LandingStoryStepId, focus = false) => {
      const index = STORY_STEPS.findIndex((item) => item.id === step);
      setActiveStep(step);
      onStepView(step, "control");
      if (focus) tabRefs.current[index]?.focus();
    },
    [onStepView],
  );

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % STORY_STEPS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + STORY_STEPS.length) % STORY_STEPS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = STORY_STEPS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectStep(STORY_STEPS[nextIndex].id, true);
  };

  return (
    <section
      id="producto"
      className={styles.section}
      aria-labelledby="sale-flow-title"
    >
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
            <p className={styles.hint}>{t.problem}</p>
          </div>
        </div>

        <div
          className={styles.desktopStory}
          data-lp-reveal-opt
          data-lp-reveal-variant="frame"
        >
          <div
            className={styles.tablist}
            role="tablist"
            aria-label={t.progressLabel}
          >
            {STORY_STEPS.map((step, index) => {
              const active = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  id={`sale-flow-tab-${step.id}`}
                  type="button"
                  role="tab"
                  className={styles.tab}
                  aria-selected={active}
                  aria-controls={`sale-flow-panel-${step.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectStep(step.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  <span className={styles.tabMarker} aria-hidden="true">
                    {step.number}
                  </span>
                  <span className={styles.tabCopy}>
                    <strong>{step.title}</strong>
                    <span className={styles.tabMeta} aria-hidden="true">
                      {step.receipt}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {STORY_STEPS.map((step) => {
            const active = activeStep === step.id;
            const capture = STORY_CAPTURE_ASSETS[step.id];
            return (
              <div
                key={step.id}
                id={`sale-flow-panel-${step.id}`}
                role="tabpanel"
                aria-labelledby={`sale-flow-tab-${step.id}`}
                className={styles.panel}
                hidden={!active}
                tabIndex={0}
              >
                <div className={styles.copy}>
                  <span className={styles.stepNumber}>
                    {step.number} · {step.title}
                  </span>
                  <h3>{step.heading}</h3>
                  <p>{step.line}</p>
                  <span className={styles.receipt}>{step.receipt}</span>
                </div>
                <figure className={styles.capture} data-step={step.id}>
                  <img
                    src={step.image}
                    alt={step.alt}
                    width={capture.width}
                    height={capture.height}
                    loading="lazy"
                    decoding="async"
                  />
                </figure>
              </div>
            );
          })}
        </div>

        <ol
          className={styles.mobileStory}
          aria-label={t.progressLabel}
          data-lp-stagger-group
        >
          {STORY_STEPS.map((step) => {
            const capture = STORY_CAPTURE_ASSETS[step.id];
            return (
              <li
                key={step.id}
                className={styles.mobileStep}
                data-lp-stagger-item
              >
                <div className={styles.mobileCopy}>
                  <span className={styles.stepNumber}>
                    {step.number} · {step.title}
                  </span>
                  <h3>{step.heading}</h3>
                  <p>{step.line}</p>
                </div>
                <figure className={styles.mobileCapture} data-step={step.id}>
                  <picture>
                    <source
                      media="(max-width: 900px)"
                      srcSet={capture.mobileImage}
                      type="image/webp"
                    />
                    <img
                      src={step.image}
                      alt={step.alt}
                      width={640}
                      height={400}
                      loading="lazy"
                      decoding="async"
                    />
                  </picture>
                </figure>
              </li>
            );
          })}
        </ol>

        <Link to={primaryTarget} className={styles.cta} onClick={onCtaClick}>
          {t.cta}
        </Link>
      </div>
    </section>
  );
}
