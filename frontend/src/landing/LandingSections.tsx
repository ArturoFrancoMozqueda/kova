import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
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

export function AudienceSection() {
  return (
    <section id="comercios" className={`${styles.section} ${styles.audience}`} aria-labelledby="audience-title">
      <div className={styles.inner}>
        <span className={styles.eyebrow}>{t.audience.eyebrow}</span>
        <h2 id="audience-title" className={styles.title}>{t.audience.title}</h2>
        <p className={styles.lead}>{t.audience.body}</p>
        <div className={styles.audienceGrid}>
          {t.audience.primary.map((item, index) => (
            <article key={item.name} className={styles.audienceItem}>
              <span>0{index + 1}</span>
              <h3>{item.name}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        <div className={styles.audienceMeta}>
          <p className={styles.audienceSecondary}>{t.audience.secondary}</p>
          <p className={styles.audienceNote}>{t.audience.note}</p>
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
        <div className={styles.quotes}>
          {t.testimonials.items.map((item) => (
            <blockquote key={item.source} className={styles.quote}>
              <p>“{item.quote}”</p>
              <footer>— {item.source}</footer>
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
