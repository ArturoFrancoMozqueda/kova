import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { TESTIMONIALS } from "./testimonials.data";
import styles from "./LandingSections.module.css";

const t = copy.landing;

export function ProblemSection() {
  return (
    <section id="problema" className={`${styles.section} ${styles.problem}`} aria-labelledby="problem-title">
      <div className={styles.inner}>
        <div className={styles.problemHeading} data-lp-stagger-group>
          <div>
            <span className={styles.eyebrow} data-lp-stagger-item>{t.problem.eyebrow}</span>
            <h2 id="problem-title" className={styles.title} data-lp-stagger-item>{t.problem.title}</h2>
          </div>
          <div data-lp-stagger-item>
            <p className={styles.lead}>{t.problem.body}</p>
          </div>
        </div>

        <div className={styles.problemNarrative} data-lp-stagger-group>
          <div className={styles.problemScenario} data-lp-stagger-item>
            <span>{t.problem.scenarioLabel}</span>
            <strong>{t.problem.scenarioAmount}</strong>
            <p>{t.problem.scenarioBody}</p>
            <div className={styles.problemRoute} aria-hidden="true">
              {t.problem.steps.map((step) => <span key={step.number}>{step.tools}</span>)}
            </div>
          </div>

          <ol className={styles.problemSteps} aria-label="Tres tareas manuales provocadas por la misma venta">
            {t.problem.steps.map((step) => (
              <li key={step.number} className={styles.problemStep} data-lp-stagger-item>
                <span className={styles.problemStepNumber} aria-hidden="true">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <strong className={styles.problemStepDetail}>{step.detail}</strong>
                </div>
                <span className={styles.problemStepTools}>{step.tools}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.problemOutcome} data-lp-stagger-group>
          <p className={styles.problemPrompt} data-lp-stagger-item>{t.problem.prompt}</p>
          <ul className={styles.problemQuestions} data-lp-stagger-item>
            {t.problem.questions.map((question) => <li key={question}>{question}</li>)}
          </ul>
          <p className={styles.problemClosing} data-lp-stagger-item>{t.problem.closing}</p>
        </div>
      </div>
    </section>
  );
}

export function CapabilitiesSection() {
  return (
    <section id="incluye" className={`${styles.section} ${styles.capabilities}`} aria-labelledby="capabilities-title">
      <div className={styles.inner}>
        <div className={styles.capabilitiesHeading} data-lp-stagger-group>
          <div>
            <span className={styles.eyebrow} data-lp-stagger-item>{t.capabilities.eyebrow}</span>
            <h2 id="capabilities-title" className={styles.title} data-lp-stagger-item>{t.capabilities.title}</h2>
          </div>
          <p className={styles.lead} data-lp-stagger-item>{t.capabilities.body}</p>
        </div>
        <ol className={styles.capabilityList} data-lp-stagger-group>
          {t.capabilities.items.map((item, index) => (
            <li key={item.title} className={styles.capability} data-lp-stagger-item>
              <span className={styles.capabilityIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <span className={styles.capabilityProof}>{item.proof}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ReportsSpotlight() {
  return (
    <section id="reportes" className={`${styles.section} ${styles.reports}`} aria-labelledby="reports-title">
      <div className={styles.inner}>
        <div className={styles.reportsHeading} data-lp-stagger-group>
          <div>
            <span className={styles.eyebrow} data-lp-stagger-item>{t.reportsSpotlight.eyebrow}</span>
            <h2 id="reports-title" className={styles.title} data-lp-stagger-item>{t.reportsSpotlight.title}</h2>
          </div>
          <p className={styles.lead} data-lp-stagger-item>{t.reportsSpotlight.body}</p>
        </div>

        <div className={styles.reportStage} data-lp-reveal-opt data-lp-reveal-variant="frame">
          <figure className={styles.reportFrame}>
            <div className={styles.reportViewport}>
              <img
                src="/showcase/reports.png"
                alt={t.reportsSpotlight.alt}
                width={1440}
                height={900}
                loading="lazy"
                decoding="async"
              />
            </div>
          </figure>
          <ol className={styles.reportQuestions} aria-label={t.reportsSpotlight.questionsLabel}>
            {t.reportsSpotlight.questions.map((question, index) => (
              <li key={question}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <strong>{question}</strong>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function TestimonialsSection({
  primaryTarget,
  onCtaClick,
}: {
  primaryTarget: string;
  onCtaClick: () => void;
}) {
  return (
    <section id="clientes" className={`${styles.section} ${styles.testimonials}`} aria-labelledby="testimonials-title">
      <div className={styles.inner}>
        <span className={styles.eyebrow}>{t.testimonials.eyebrow}</span>
        <h2 id="testimonials-title" className={styles.title}>{t.testimonials.title}</h2>
        <p className={styles.testimonialNote}>{t.testimonials.note}</p>
        <div className={styles.quotes}>
          {TESTIMONIALS.map((item, index) => (
            <blockquote key={item.business} className={styles.quote}>
              <div className={styles.quoteTop}>
                <span className={styles.quoteNumber} aria-hidden="true">0{index + 1}</span>
                <span className={styles.quoteOutcome}>{item.outcome}</span>
              </div>
              <p>“{item.quote}”</p>
              <footer>{item.business}</footer>
            </blockquote>
          ))}
        </div>
        <Link to={primaryTarget} className={styles.cta} onClick={onCtaClick}>
          {t.testimonials.cta}
        </Link>
      </div>
    </section>
  );
}
