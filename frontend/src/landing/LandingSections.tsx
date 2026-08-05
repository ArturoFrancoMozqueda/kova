import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { TESTIMONIALS } from "./testimonials.data";
import styles from "./LandingSections.module.css";

const t = copy.landing;

export function TrustBar() {
  return (
    <section className={styles.trust} aria-labelledby="trust-title">
      <div className={styles.trustInner}>
        <div>
          <span className={styles.eyebrow}>{t.trust.eyebrow}</span>
          <h2 id="trust-title" className={styles.trustTitle}>{t.trust.title}</h2>
        </div>
        <div className={styles.trustNames} aria-label="Negocios que usan Kova">
          {t.trust.names.map((name) => (
            <span key={name} className={styles.trustName}>{name}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BenefitsSection() {
  return (
    <section id="beneficios" className={styles.section} aria-labelledby="benefits-title">
      <div className={styles.inner}>
        <span className={styles.eyebrow}>{t.benefits.eyebrow}</span>
        <h2 id="benefits-title" className={styles.title}>{t.benefits.title}</h2>
        <ol className={styles.benefitGrid}>
          {t.benefits.items.map((item, index) => (
            <li key={item.title} className={styles.benefit}>
              <div className={styles.benefitVisual}>
                <img
                  src={item.image}
                  alt={item.alt}
                  width={1440}
                  height={900}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className={styles.benefitCopy}>
                <span className={styles.benefitIndex} aria-hidden="true">{index + 1}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <p className={styles.consequence}>{item.consequence}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

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
            <p className={styles.problemPrompt}>{t.problem.prompt}</p>
            <ul className={styles.problemQuestions}>
              {t.problem.questions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          </div>
        </div>

        <div className={styles.manualFlow} data-lp-stagger-group>
          <ol className={styles.problemSteps} aria-label="Tres tareas manuales provocadas por la misma venta">
            {t.problem.steps.map((step) => (
              <li key={step.number} className={styles.problemStep} data-lp-stagger-item>
                <div className={styles.problemStepTop}>
                  <span className={styles.problemStepNumber} aria-hidden="true">{step.number}</span>
                  <span className={styles.problemStepTools}>{step.tools}</span>
                </div>
                <h3>{step.title}</h3>
                <strong className={styles.problemStepDetail}>{step.detail}</strong>
              </li>
            ))}
          </ol>
          <p className={styles.problemClosing} data-lp-stagger-item>{t.problem.closing}</p>
        </div>
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
            <div className={styles.browserBar} aria-hidden="true">
              <span className={styles.browserDots}>● ● ●</span>
              <span>kovasuite.com</span>
              <span>{t.reportsSpotlight.productLabel}</span>
            </div>
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
          <ul className={styles.reportInsights} data-lp-stagger-group aria-label="Datos visibles en la captura de Reportes">
            {t.reportsSpotlight.insights.map((insight, index) => (
              <li key={insight.label} data-position={index + 1} data-lp-stagger-item>
                <span>{insight.label}</span>
                <strong>{insight.value}</strong>
              </li>
            ))}
          </ul>
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

export function ValueBridge() {
  return (
    <section id="valor" className={styles.valueBridge} aria-labelledby="value-title">
      <div className={styles.valueInner}>
        <div className={styles.valueCopy}>
          <span className={styles.eyebrow}>{t.pricing.worthItEyebrow}</span>
          <h2 id="value-title">{t.pricing.worthItTitle}</h2>
          <p>{t.pricing.worthItBody}</p>
        </div>
        <div className={styles.valueOffer} aria-label={t.pricing.worthItPlan}>
          <div className={styles.valuePrice}>
            <strong className="tabular">{t.pricing.worthItDaily}</strong>
            <span>{t.pricing.worthItDailyLabel}</span>
          </div>
          <ul className={styles.valueItems}>
            {t.pricing.worthItItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className={styles.valuePlan}>{t.pricing.worthItPlan}</p>
        </div>
      </div>
    </section>
  );
}
