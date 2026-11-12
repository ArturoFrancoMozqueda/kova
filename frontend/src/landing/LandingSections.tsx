import type { ReactNode } from "react";
import {
  BarChart3,
  Check,
  Heart,
  PackageSearch,
  QrCode,
  ShoppingBag,
  X,
} from "lucide-react";
import type { PublicPlansState } from "@/billing/publicPlans";
import type { PlanFeature } from "@/billing/entitlements";
import type { CommercialPlan } from "@/billing/types";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";
import { SWEET_HOME_REPORTS } from "./demo/sweetHome";
import {
  REGISTER_DEMO_CART,
  REGISTER_DEMO_TOTAL,
  TOUR_INVENTORY,
  demoProduct,
} from "./demo/registerDemoCatalog";
import { TESTIMONIALS } from "./testimonials.data";
import styles from "./LandingSections.module.css";

const t = copy.landing;

type PillarId = (typeof t.capabilities.pillars)[number]["id"];

const PILLAR_ICONS: Record<PillarId, typeof ShoppingBag> = {
  cobra: ShoppingBag,
  controla: PackageSearch,
  vende: QrCode,
  regresan: Heart,
  entiende: BarChart3,
};

const productName = (id: string) => demoProduct(id).name;
const productPrice = (id: string) => demoProduct(id).price;

/**
 * Planes de la oferta vigente (Esencial/Gestión), de menor a mayor precio,
 * solo cuando el catálogo público del servidor la confirma. Cualquier otro
 * estado (cargando, error u otra oferta) devuelve null y no se anuncia precio.
 */
export function offeredPlans(offer: PublicPlansState): CommercialPlan[] | null {
  if (offer.status !== "ready" || !offer.catalog.tiered_pricing_enabled) return null;
  return [...offer.catalog.available_plans].sort(
    (a, b) => a.amount_minor_units - b.amount_minor_units,
  );
}

/** Plan que hace falta para una función que no viene en el plan de entrada. */
export function requiredPlanName(
  offer: PublicPlansState,
  feature: string | null,
): string | null {
  const plans = offeredPlans(offer);
  if (!feature || !plans) return null;
  const first = plans.find((plan) => plan.features.includes(feature as PlanFeature));
  if (!first || first === plans[0]) return null;
  return first.name;
}

export function ProblemSection() {
  const p = t.problem;
  return (
    <section
      id="problema"
      className={`${styles.section} ${styles.problem}`}
      aria-labelledby="problem-title"
    >
      <div className={styles.inner}>
        <div className={styles.problemHeading} data-lp-stagger-group>
          <div>
            <h2 id="problem-title" className={styles.title} data-lp-stagger-item>
              {p.title}
            </h2>
          </div>
          <p className={styles.lead} data-lp-stagger-item>
            {p.body}
          </p>
        </div>

        <div className={styles.mirror} data-lp-reveal-opt>
          <div className={styles.mirrorHead} aria-hidden="true">
            <span>{p.beforeLabel}</span>
            <span>{p.afterLabel}</span>
          </div>
          <ul className={styles.mirrorRows} data-lp-stagger-group>
            {p.rows.map((row) => (
              <li key={row.before} className={styles.mirrorRow} data-lp-stagger-item>
                <span className={styles.mirrorBefore}>
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                  <span>
                    <span className={styles.srOnly}>{p.beforeLabel}: </span>
                    {row.before}
                  </span>
                </span>
                <span className={styles.mirrorAfter}>
                  <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                  <span>
                    <span className={styles.srOnly}>{p.afterLabel}: </span>
                    {row.after}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.problemClosing}>{p.closing}</p>
      </div>
    </section>
  );
}

/* Mini-interfaces decorativas por pilar: mismos datos de Sweet Home que el
   resto de la landing. El contenido real de cada pilar es la lista de texto. */
function PillarPreview({ id }: { id: PillarId }): ReactNode {
  if (id === "cobra") {
    return (
      <div className={styles.preview}>
        <span className={styles.previewLabel}>{t.sweetHome.currentSale}</span>
        {Object.entries(REGISTER_DEMO_CART).map(([productId, qty]) => (
          <div key={productId} className={styles.previewRow}>
            <span>{qty} × {productName(productId)}</span>
            <strong>{formatMoney(productPrice(productId) * qty)}</strong>
          </div>
        ))}
        <div className={styles.previewChips}>
          <span data-active="true">{t.sweetHome.paymentCash}</span>
          <span>{t.sweetHome.paymentTransfer}</span>
          <span>{t.sweetHome.paymentCard}</span>
        </div>
        <span className={styles.previewAction}>
          {t.sweetHome.charge(formatMoney(REGISTER_DEMO_TOTAL))}
        </span>
      </div>
    );
  }
  if (id === "controla") {
    return (
      <div className={styles.preview}>
        <span className={styles.previewLabel}>
          {t.sweetHome.lowStockCount(TOUR_INVENTORY.filter((item) => item.after <= item.threshold).length)}
        </span>
        {TOUR_INVENTORY.slice(0, 3).map((item) => (
          <div key={item.id} className={styles.previewRow} data-warn={item.after <= item.threshold ? "true" : undefined}>
            <span>{productName(item.id)}</span>
            <strong>{item.after}</strong>
          </div>
        ))}
      </div>
    );
  }
  if (id === "vende") {
    return (
      <div className={`${styles.preview} ${styles.previewMenu}`}>
        <div>
          <span className={styles.previewLabel}>{t.sweetHome.shopName}</span>
          {["cold-brew", "capuchino", "croissant"].map((productId) => (
            <div key={productId} className={styles.previewRow}>
              <span>{productName(productId)}</span>
              <strong>{formatMoney(productPrice(productId))}</strong>
            </div>
          ))}
        </div>
        <span className={styles.previewQr}>
          <QrCode size={44} strokeWidth={1.4} />
        </span>
      </div>
    );
  }
  if (id === "regresan") {
    return (
      <div className={`${styles.preview} ${styles.previewCard}`}>
        <span className={styles.previewLabel}>{t.sweetHome.shopName}</span>
        <strong className={styles.previewBig}>120 pts</strong>
        <span className={styles.previewMeter}><span style={{ width: "80%" }} /></span>
        <QrCode size={28} strokeWidth={1.4} className={styles.previewCardQr} />
      </div>
    );
  }
  return (
    <div className={styles.preview}>
      <span className={styles.previewLabel}>
        {t.sweetHome.bestHoursSummary(SWEET_HOME_REPORTS.bestHoursLabel)}
      </span>
      <strong className={styles.previewBig}>{formatMoney(SWEET_HOME_REPORTS.netSales)}</strong>
      <div className={styles.previewBars}>
        {SWEET_HOME_REPORTS.hourly.map((bar) => (
          <span key={bar.label} data-best={bar.best ? "true" : undefined} style={{ height: `${bar.pct}%` }} />
        ))}
      </div>
    </div>
  );
}

export function CapabilitiesSection({ offer }: { offer: PublicPlansState }) {
  const c = t.capabilities;
  return (
    <section
      id="incluye"
      className={`${styles.section} ${styles.capabilities}`}
      aria-labelledby="capabilities-title"
    >
      <div className={styles.inner}>
        <div className={styles.capabilitiesHeading} data-lp-stagger-group>
          <div>
            <h2 id="capabilities-title" className={styles.title} data-lp-stagger-item>
              {c.title}
            </h2>
          </div>
          <p className={styles.lead} data-lp-stagger-item>
            {c.body}
          </p>
        </div>

        <div className={styles.pillars}>
          {c.pillars.map((pillar) => {
            const Icon = PILLAR_ICONS[pillar.id];
            return (
              <article
                key={pillar.id}
                className={styles.pillar}
                aria-labelledby={`pillar-${pillar.id}`}
                data-lp-reveal-opt
              >
                <div className={styles.pillarIntro}>
                  <span className={styles.capabilityIcon} aria-hidden="true">
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  <h3 id={`pillar-${pillar.id}`}>{pillar.title}</h3>
                  <p>{pillar.line}</p>
                  <div aria-hidden="true">
                    <PillarPreview id={pillar.id} />
                  </div>
                </div>
                <ul className={styles.pillarItems}>
                  {pillar.items.map((item) => {
                    const plan = requiredPlanName(offer, item.feature);
                    return (
                      <li key={item.title}>
                        <div className={styles.pillarItemTop}>
                          <h4>{item.title}</h4>
                          {plan && (
                            <span className={styles.planBadge}>
                              {c.planBadgePrefix} {plan}
                            </span>
                          )}
                        </div>
                        <p>{item.body}</p>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ReportsSpotlight() {
  return (
    <section
      id="reportes"
      className={`${styles.section} ${styles.reports}`}
      aria-labelledby="reports-title"
    >
      <div className={styles.inner}>
        <div className={styles.reportsHeading} data-lp-stagger-group>
          <div>
            <h2
              id="reports-title"
              className={styles.title}
              data-lp-stagger-item
            >
              {t.reportsSpotlight.title}
            </h2>
          </div>
          <p className={styles.lead} data-lp-stagger-item>
            {t.reportsSpotlight.body}
          </p>
        </div>

        <div
          className={styles.reportStage}
          data-lp-reveal-opt
          data-lp-reveal-variant="frame"
        >
          <figure className={styles.reportFrame}>
            <div className={styles.reportViewport}>
              <img
                src="/showcase/analysis-story.jpeg"
                alt={t.reportsSpotlight.alt}
                width={3196}
                height={1811}
                loading="lazy"
                decoding="async"
              />
            </div>
          </figure>
          <ol
            className={styles.reportQuestions}
            aria-label={t.reportsSpotlight.questionsLabel}
          >
            {t.reportsSpotlight.questions.map((question, index) => (
              <li key={question}>
                <span aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{question}</strong>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* Prueba social inmediatamente después del hero: citas reales, compactas,
   con el logo del negocio cuando tenemos permiso para usarlo. */
export function TestimonialsSection() {
  if (TESTIMONIALS.length === 0) return null;
  return (
    <section
      id="clientes"
      className={`${styles.section} ${styles.testimonials}`}
      aria-labelledby="testimonials-title"
    >
      <div className={styles.inner}>
        <h2 id="testimonials-title" className={styles.srOnly}>{t.testimonials.stripAria}</h2>
        <div className={styles.quotes} data-lp-stagger-group>
          {TESTIMONIALS.map((item) => (
            <blockquote key={item.business} className={styles.quote} data-lp-stagger-item>
              <p>“{item.quote}”</p>
              <footer className={styles.quoteAuthor}>
                {item.logo ? (
                  <picture>
                    <source srcSet={item.logo.replace(/\.png$/, ".webp")} type="image/webp" />
                    <img src={item.logo} alt="" width={44} height={44} loading="lazy" decoding="async" className={styles.quoteLogo} />
                  </picture>
                ) : (
                  <span className={styles.quoteInitials} aria-hidden="true">
                    {item.business.split(/\s+/).map((word) => word[0]).join("").slice(0, 2)}
                  </span>
                )}
                <span>
                  <strong>{item.business}</strong>
                  <span>{item.city ?? item.outcome}</span>
                </span>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}
