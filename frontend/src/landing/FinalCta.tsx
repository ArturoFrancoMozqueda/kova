// CTA final (brief §1.8): cierre con acción única; absorbe FirstDay como
// mini-fila de 4 pasos. Banda de acento sobre fondo ink.
import { Link } from "react-router-dom";
import { Reveal } from "@/components/motion/Reveal";
import { copy } from "@/i18n/messages";

const t = copy.landing.finalCta;

export default function FinalCta({
  primaryTarget,
  onCtaClick,
}: {
  primaryTarget: string;
  onCtaClick?: () => void;
}) {
  return (
    <section id="cta-final" className="lp-section">
      <Reveal className="lp-section-inner">
        <div className="lp-cta-band">
          <h2 className="lp-section-title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", textAlign: "center" }}>
            {t.title}
          </h2>

          <ol className="lp-cta-steps">
            {t.steps.map((step, i) => (
              <li key={step} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  className="tabular"
                  aria-hidden="true"
                  style={{
                    width: 24, height: 24, borderRadius: 999, flexShrink: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "var(--accent-soft)", color: "var(--accent)",
                    fontSize: 12, fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--page-fg)", lineHeight: 1.25 }}>{step}</span>
              </li>
            ))}
          </ol>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Link
              to={primaryTarget}
              onClick={onCtaClick}
              className="lp-cta-fill"
              style={{
                background: "var(--cta-blue, var(--kova-blue))", color: "#fff",
                padding: "14px 26px", borderRadius: 10,
                fontWeight: 600, fontSize: 14, textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 8,
              }}
            >
              <span>{t.button}</span>
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.fineprint}</span>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
