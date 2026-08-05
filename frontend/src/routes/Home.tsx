import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import {
  trackAnonymousEvent,
  trackAnonymousEventOnce,
} from "@/telemetry/funnel";
import {
  STANDARD_PLAN_AMOUNT,
  STANDARD_PLAN_PRICE_LABEL_ES,
  STANDARD_PLAN_PRICE_CADENCE_ES,
} from "@/billing/standardPlan";
import Logo from "@/components/brand/Logo";
import { LogoMark } from "@/components/brand/Logo";
import FinalCta from "@/landing/FinalCta";
import {
  CapabilitiesSection,
  ProblemSection,
  ReportsSpotlight,
  TestimonialsSection,
  TrustBar,
} from "@/landing/LandingSections";
import { TicketPaper } from "@/landing/Ticket";
import HeroProductFrame from "@/landing/HeroProductFrame";
import SaleFlowStory, {
  type LandingStoryStepId,
  type LandingStoryTrigger,
} from "@/landing/SaleFlowStory";
import { LANDING_STYLES, RESPONSIVE_STYLES, themeVars, type Theme } from "@/landing/landingTheme";
import { useLandingRevealMotion } from "@/landing/useRevealMotion";
import { copy } from "@/i18n/messages";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_WHATSAPP } from "@/lib/support";

const t = copy.landing;

// Theme vars + landing CSS (themeVars, LANDING_STYLES, RESPONSIVE_STYLES) live
// in @/landing/landingTheme so the marketing showcase can reuse them verbatim.
// El reveal-on-scroll (useLandingRevealMotion) vive en @/landing/useRevealMotion
// para que SaleStory y otras secciones reusen el mismo mecanismo.

/* ─── Navbar ─────────────────────────────────────────────────────────────── */
const NAV_LINKS = [
  { label: t.nav.howItWorks, href: "#producto" },
  { label: t.nav.customers, href: "#clientes" },
  { label: t.nav.price, href: "#precio" },
  { label: t.nav.questions, href: "#faq" },
];

function Navbar({
  primaryTarget,
  isAuthenticated,
  onCtaClick,
  onLoginClick,
}: {
  primaryTarget: string;
  isAuthenticated: boolean;
  onCtaClick: (cta: string) => void;
  onLoginClick: () => void;
}) {
  // Estado "scrolled": se activa post-hidratación vía efecto (nunca en SSR), así
  // el HTML prerenderizado siempre nace en el estado tope-de-página y la
  // hidratación coincide. El listener es passive + rAF-throttled.
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > 12);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Escape cierra el menú móvil y devuelve el foco al botón (disclosure, no modal).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <nav className="lp-nav" data-scrolled={scrolled ? "true" : "false"}>
      <div className="lp-nav-shell">
        <span style={{ color: "var(--page-fg)", display: "inline-flex" }}>
          <Logo
            variant="horizontal"
            size={24}
            circuitColor="currentColor"
            wordmarkColor="currentColor"
            coreColor="var(--accent)"
            title="kova"
          />
        </span>

        <div className="lp-desktop-nav" style={{ display: "flex", gap: 28, fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="lp-nav-link" style={{ color: "inherit", textDecoration: "none" }}>
              {l.label}
            </a>
          ))}
        </div>

        <div className="lp-nav-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isAuthenticated && (
            <Link
              to="/login"
              onClick={onLoginClick}
              style={{
                fontSize: 13, fontWeight: 500, color: "var(--page-fg)",
                padding: "8px 12px", textDecoration: "none",
              }}
              className="hidden sm:inline-flex"
            >
              {t.nav.login}
            </Link>
          )}
          <Link
            className="lp-nav-primary lp-cta-fill"
            to={primaryTarget}
            onClick={() => onCtaClick("hero")}
            style={{
              fontSize: 13, fontWeight: 600,
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "9px 14px", borderRadius: 8, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <span>{isAuthenticated ? t.nav.goToDashboard : t.nav.createAccount}</span>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="lp-nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-menu"
            aria-label={menuOpen ? t.nav.menuClose : t.nav.menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              {menuOpen ? (
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              ) : (
                <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <div id="lp-mobile-menu" className="lp-mobile-menu" data-open={menuOpen ? "true" : "false"}>
        <div className="lp-mobile-menu-inner">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="lp-mobile-link" onClick={closeMenu}>
              {l.label}
            </a>
          ))}
          {!isAuthenticated && (
            <Link
              to="/login"
              className="lp-mobile-link"
              onClick={() => {
                closeMenu();
                onLoginClick();
              }}
            >
              {t.nav.login}
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

/* ─── MXN Ticker ─────────────────────────────────────────────────────────── */
/* ─── Hero ───────────────────────────────────────────────────────────────── */
function Hero({
  primaryTarget,
  onCtaClick,
}: {
  primaryTarget: string;
  onCtaClick: (cta: string) => void;
}) {
  return (
    <section className="lp-hero-section" style={{ position: "relative", overflow: "hidden" }}>
      <div className="lp-hero-shell lp-section-inner" style={{ position: "relative" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.05fr)",
            gap: 52,
            alignItems: "center",
          }}
          className="lp-hero-grid"
        >
          <div className="lp-hero-content">
            <span className="lp-hero-eyebrow">
              {t.hero.eyebrow}
            </span>
            <h1
              className="lp-hero-title"
              style={{
                fontSize: "clamp(36px, 4.6vw, 60px)",
                fontWeight: 600,
                letterSpacing: "-0.015em",
                lineHeight: 1,
                margin: 0,
                color: "var(--page-fg)",
              }}
            >
              {t.hero.title}
            </h1>

            <p className="lp-hero-copy" style={{ fontSize: 17, lineHeight: 1.55, color: "var(--text-muted)", marginTop: 20, maxWidth: 560 }}>
              {t.hero.subtitle}
            </p>

            <div className="lp-hero-actions" style={{ display: "flex", gap: 10, marginTop: 32, flexWrap: "wrap" }}>
              <Link
                to={primaryTarget}
                onClick={() => onCtaClick("hero")}
                className="lp-cta-fill"
                style={{
                  background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 600, fontSize: 14, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                <span>{t.hero.ctaPrimary}</span>
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#producto"
                className="lp-cta-fill"
                style={{
                  background: "var(--surface)", color: "var(--page-fg)",
                  padding: "14px 22px", borderRadius: 10,
                  fontWeight: 500, fontSize: 14, textDecoration: "none",
                  border: "0.5px solid var(--hairline-color)",
                }}
              >
                <span>{t.hero.ctaSecondary}</span>
              </a>
            </div>

            <p className="lp-hero-pricing">
              <strong>{STANDARD_PLAN_PRICE_LABEL_ES}</strong>
              <span aria-hidden="true">·</span>
              <span>{t.hero.trialBadge}</span>
            </p>
          </div>

          <div className="lp-hero-visual">
            <HeroProductFrame />
          </div>
        </div>

      </div>
    </section>
  );
}

/* ─── Problem ────────────────────────────────────────────────────────────── */
// Textura y rotación por recorte, alineadas por índice con p.fragments
// (Libreta=rayado, Excel=celdas, WhatsApp=burbuja, Tickets=punteado, Caja=liso).
/* ─── Differentiation ────────────────────────────────────────────────────── */
/* ─── FAQ ────────────────────────────────────────────────────────────────── */
function FAQ({
  onOpen,
  onWhatsAppClick,
}: {
  onOpen: (faq: string) => void;
  onWhatsAppClick: (section: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const items = t.faq.items;

  return (
    <section id="faq" className="lp-section lp-section-compact">
      <div className="lp-section-inner" style={{ maxWidth: 980 }}>
        <div data-lp-stagger-group>
          <span className="lp-section-label" data-lp-stagger-item style={{ marginBottom: 24 }}>
            {t.faq.eyebrow}
          </span>
          <h2 className="lp-section-title" data-lp-stagger-item style={{ maxWidth: 720 }}>
            {t.faq.title}
          </h2>
        </div>

        <div data-lp-reveal-opt style={{ marginTop: 34, borderTop: "0.5px solid var(--hairline-color)" }}>
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderBottom: "0.5px solid var(--hairline-color)" }}>
                <button
                  type="button"
                  id={`lp-faq-q-${i}`}
                  onClick={() => {
                    setOpen(isOpen ? null : i);
                    if (!isOpen) onOpen(`faq_${i + 1}`);
                  }}
                  aria-expanded={isOpen}
                  aria-controls={`lp-faq-a-${i}`}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    padding: "18px 4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "var(--page-fg)",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 }}>
                    {it.q}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 22, height: 22, borderRadius: 999,
                      border: "0.5px solid var(--hairline-color)",
                      background: isOpen ? "var(--accent)" : "var(--surface)",
                      color: isOpen ? "#fff" : "var(--page-fg)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      transition: "all 180ms var(--kova-ease-entrance)",
                      transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
                {/* Respuesta siempre montada (SEO + animación grid-rows). Cerrada
                    se colapsa a 0fr y visibility:hidden la saca del orden de
                    tabulación y del lector de pantalla. */}
                <div
                  id={`lp-faq-a-${i}`}
                  role="region"
                  aria-labelledby={`lp-faq-q-${i}`}
                  className="lp-faq-panel"
                  data-open={isOpen ? "true" : "false"}
                >
                  <div className="lp-faq-panel-inner">
                    <div className="lp-faq-answer">{it.a}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ marginTop: 40, fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>
          {t.faq.contactPrefix}
          <a
            href={SUPPORT_MAILTO}
            style={{ color: "var(--accent)", fontWeight: 500, textDecoration: "none", borderBottom: "1px solid var(--accent-soft)" }}
          >
            {t.faq.contactLink}
          </a>
          {t.faq.contactSuffix}
          {" "}
          <a
            href={SUPPORT_WHATSAPP}
            onClick={() => onWhatsAppClick("faq")}
            style={{ color: "var(--accent)", fontWeight: 500, textDecoration: "none", borderBottom: "1px solid var(--accent-soft)" }}
          >
            {t.footer.whatsapp}
          </a>
        </p>
      </div>
    </section>
  );
}

/* ─── Pricing ────────────────────────────────────────────────────────────── */
/** Índice de línea del recibo → delay de impresión (var CSS --tkt-i). */
const tktLine = (i: number): CSSProperties => ({ ["--tkt-i" as string]: String(i) });

function Pricing({
  primaryTarget,
  onCtaClick,
}: {
  primaryTarget: string;
  onCtaClick: (cta: string) => void;
}) {
  const feats = t.pricing.features;
  return (
    <section id="precio" className="lp-section lp-reveal-block">
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24, justifyContent: "center" }}>
          <span className="lp-section-label">{t.pricing.eyebrow}</span>
        </div>
        <h2 className="lp-section-title" style={{ textAlign: "center" }}>
          {t.pricing.titleLine1}<br />{t.pricing.titleLine2}
        </h2>
        <p className="lp-section-copy" style={{ maxWidth: 620, textAlign: "center", marginLeft: "auto", marginRight: "auto" }}>
          {t.pricing.leadStart}
          <strong style={{ color: "var(--page-fg)", fontWeight: 600 }}>{t.pricing.leadEmphasis}</strong>
          {t.pricing.leadEnd}
        </p>

        <p style={{ marginTop: 30, marginBottom: 0, textAlign: "center", fontSize: 13, fontWeight: 500, letterSpacing: "0.04em", color: "var(--text-muted)" }}>
          {t.pricing.bridge}
        </p>
        <div className="lp-ticket-print" style={{ marginTop: 14, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
          {/* El ticket vivo: el plan enunciado como recibo térmico. Las líneas
              se "imprimen" en orden al entrar en viewport (lp-tkt-print). */}
          <TicketPaper>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div className="lp-tkt-line" style={tktLine(0)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div className="lp-tkt-label" style={{ fontSize: 13 }}>{t.pricing.planName}</div>
                    <div style={{ fontSize: 13, marginTop: 6, color: "var(--ticket-muted)", lineHeight: 1.45 }}>{t.pricing.planSubtitle}</div>
                  </div>
                  <LogoMark size={26} circuitColor="var(--ticket-muted)" coreColor="var(--kova-blue)" />
                </div>
              </div>

              <hr className="lp-tkt-rule lp-tkt-line" style={tktLine(1)} />

              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {feats.map((f, i) => (
                  <li
                    key={f}
                    className="lp-tkt-line"
                    style={{ ...tktLine(2 + i), display: "flex", alignItems: "baseline", fontSize: 14, color: "var(--ticket-ink)", lineHeight: 1.4 }}
                  >
                    <span>{f}</span>
                    <span className="lp-tkt-leader" aria-hidden="true" />
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, alignSelf: "center" }} aria-hidden="true">
                      <path d="M2 6L5 9L10 3" stroke="var(--ticket-ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </li>
                ))}
              </ul>

              <hr className="lp-tkt-rule lp-tkt-line" style={tktLine(2 + feats.length)} />

              <div className="lp-tkt-line" style={tktLine(3 + feats.length)}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span className="lp-tkt-label">{t.pricing.receiptTotalLabel}</span>
                  <span className="tabular" style={{ display: "inline-flex", alignItems: "baseline", gap: 5, color: "var(--ticket-ink)" }}>
                    <span style={{ fontSize: 16, color: "var(--ticket-muted)" }}>$</span>
                    <span className="lp-tkt-money lp-tkt-total-num" style={{ fontSize: 64 }}>{STANDARD_PLAN_AMOUNT}</span>
                    <span style={{ fontSize: 14, color: "var(--ticket-muted)" }}>{STANDARD_PLAN_PRICE_CADENCE_ES}</span>
                  </span>
                </div>
              </div>
            </div>
          </TicketPaper>

          {/* Pestaña desprendible: el CTA como talón cortado del recibo. */}
          <TicketPaper className="lp-tkt-tab" style={tktLine(4 + feats.length)}>
            <Link
              to={primaryTarget}
              onClick={() => onCtaClick("pricing")}
              className="lp-cta-fill"
              style={{
                width: "100%", background: "var(--cta-blue, var(--kova-blue))", color: "#fff",
                padding: "14px 16px", borderRadius: 10, border: "none",
                fontWeight: 600, fontSize: 14, fontFamily: "inherit",
                textAlign: "center", textDecoration: "none", display: "block",
              }}
            >
              <span>{t.pricing.ctaButton}</span>
            </Link>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--ticket-muted)", marginTop: 10 }}>
              {t.pricing.ctaFineprint}
            </div>
          </TicketPaper>

          <div
            style={{
              marginTop: 18, display: "flex", flexWrap: "wrap", justifyContent: "center",
              alignItems: "center", gap: "6px 18px", fontSize: 12, color: "var(--text-muted)",
            }}
          >
            {t.pricing.trustItems.map((item) => (
              <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {item}
              </span>
            ))}
            <Link
              to="/seguridad"
              style={{ color: "var(--text-muted)", fontWeight: 500, textDecoration: "none", borderBottom: "1px solid var(--hairline-color)" }}
            >
              {t.pricing.trustSecurityLink}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────── */
function Footer({
  onLoginClick,
  onWhatsAppClick,
}: {
  onLoginClick: () => void;
  onWhatsAppClick: (section: string) => void;
}) {
  return (
    <footer style={{ padding: "80px 32px 56px", borderTop: "0.5px solid var(--hairline-color)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 48, alignItems: "start" }} className="lp-footer-grid">
          <div>
            <span style={{ color: "var(--page-fg)", display: "inline-flex" }}>
              <Logo size={24} circuitColor="currentColor" wordmarkColor="currentColor" coreColor="var(--accent)" />
            </span>
            <p style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 340, marginTop: 16, lineHeight: 1.55 }}>
              {t.footer.tagline}
            </p>
            <div className="lp-human-note">{t.footer.humansBadge}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
              {t.footer.contactHeading}
            </div>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.55, maxWidth: 360 }}>
              {t.footer.contactBody}
            </p>
            <a
              href={SUPPORT_MAILTO}
              style={{ display: "inline-flex", marginTop: 16, fontSize: 14, fontWeight: 500, color: "var(--page-fg)", textDecoration: "none", borderBottom: "1px solid var(--hairline-color)" }}
            >
              {SUPPORT_EMAIL}
            </a>
            <a
              href={SUPPORT_WHATSAPP}
              onClick={() => onWhatsAppClick("footer")}
              style={{ display: "flex", width: "fit-content", marginTop: 12, fontSize: 14, fontWeight: 500, color: "var(--page-fg)", textDecoration: "none", borderBottom: "1px solid var(--hairline-color)" }}
            >
              {t.footer.whatsapp}
            </a>
          </div>
        </div>
        <div style={{ marginTop: 64, paddingTop: 24, borderTop: "0.5px solid var(--hairline-color)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-tertiary)", flexWrap: "wrap", gap: 16 }}>
          <span>{t.footer.copyright}</span>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link to="/login" onClick={onLoginClick} style={footerLinkStyle}>{t.footer.login}</Link>
            <Link to="/privacy" style={footerLinkStyle}>{t.footer.privacy}</Link>
            <Link to="/terms" style={footerLinkStyle}>{t.footer.terms}</Link>
            <Link to="/seguridad" style={footerLinkStyle}>{t.footer.security}</Link>
            <Link to="/cookies" style={footerLinkStyle}>{t.footer.cookies}</Link>
            <a href={SUPPORT_MAILTO} style={footerLinkStyle}>{t.footer.support}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
const footerLinkStyle: CSSProperties = { color: "var(--text-tertiary)", textDecoration: "none" };

/* ─── Responsive helper ──────────────────────────────────────────────────── */

/* ─── Home ───────────────────────────────────────────────────────────────── */
export default function Home(): ReactNode {
  const { state } = useAuth();
  const isAuthenticated = state.status === "authenticated";
  const primaryTarget = isAuthenticated ? "/dashboard" : "/signup";
  const theme: Theme = "light";

  const rootStyle = useMemo(() => themeVars(theme), [theme]);
  useLandingRevealMotion();

  // Top-of-funnel instrumentation (PLAN-UX-03). Anonymous, client_id-keyed, no
  // PII — makes landing → CTA → signup measurable. `landing_viewed` fires once
  // per page load; each primary CTA reports `landing_cta_clicked`, and when the
  // CTA leads to signup it also reports `signup_started` (the pre-auth rung that
  // links to the later authenticated `signup_completed` via the same client_id).
  useEffect(() => {
    trackAnonymousEventOnce("landing_viewed", "landing_viewed");
  }, []);

  // Scroll-depth por sección: `landing_section_viewed` marca hasta dónde llegó
  // el visitante (una vez por sección por carga, mismo guard in-memory que
  // landing_viewed). El hero no se observa — landing_viewed ya lo cubre. El
  // rootMargin cuenta la sección como vista cuando su borde superior cruza el
  // 65% del viewport, para que también dispare en secciones más altas que la
  // pantalla (un threshold por ratio nunca se alcanzaría ahí).
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(".lp-root main > section[id]"),
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const section = (entry.target as HTMLElement).id;
          trackAnonymousEventOnce(`section:${section}`, "landing_section_viewed", { section });
          if (section === "producto") {
            trackAnonymousEventOnce("product_demo_viewed", "product_demo_viewed", {
              section,
            });
          }
          if (section === "precio") {
            trackAnonymousEventOnce("pricing_viewed", "pricing_viewed", { section });
          }
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -35% 0px", threshold: 0.01 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const onCtaClick = useCallback(
    (cta: string) => {
      void trackAnonymousEvent("landing_cta_clicked", { cta });
      if (primaryTarget === "/signup") {
        void trackAnonymousEvent("signup_started", { cta });
      }
    },
    [primaryTarget],
  );

  const onStoryStepView = useCallback(
    (step: LandingStoryStepId, trigger: LandingStoryTrigger) => {
      trackAnonymousEventOnce(
        `story:${step}`,
        "landing_story_step_viewed",
        { step, trigger },
      );
      if (trigger === "control") {
        void trackAnonymousEvent("product_demo_step_changed", { step, trigger });
      }
    },
    [],
  );

  const onLoginClick = useCallback(() => {
    void trackAnonymousEvent("login_clicked", { section: "navigation" });
  }, []);

  const onWhatsAppClick = useCallback((section: string) => {
    void trackAnonymousEvent("whatsapp_clicked", { section });
  }, []);

  const onFaqOpen = useCallback((section: string) => {
    void trackAnonymousEvent("faq_opened", { section });
  }, []);

  // Paint html/body with the same landing background while this view is mounted.
  // Prevents the white body bg from showing on viewports wider than the natural
  // .lp-root width (was the right-side white strip on >=1440px monitors).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    const landingBg = "#FBFBFD"; // matches light theme --page-bg
    html.style.background = landingBg;
    body.style.background = landingBg;
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, []);

  return (
    <div className="lp-root" style={rootStyle}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_STYLES + RESPONSIVE_STYLES }} />
      <a className="lp-skip-link" href="#contenido-principal">
        Ir al contenido
      </a>
      <Navbar
        primaryTarget={primaryTarget}
        isAuthenticated={isAuthenticated}
        onCtaClick={onCtaClick}
        onLoginClick={onLoginClick}
      />
      <main id="contenido-principal">
        <Hero
          primaryTarget={primaryTarget}
          onCtaClick={onCtaClick}
        />
        <TrustBar />
        <ProblemSection />
        <SaleFlowStory
          primaryTarget={primaryTarget}
          onCtaClick={() => onCtaClick("story")}
          onStepView={onStoryStepView}
        />
        <CapabilitiesSection />
        <ReportsSpotlight />
        <TestimonialsSection
          primaryTarget={primaryTarget}
          onCtaClick={() => onCtaClick("testimonials")}
        />
        <Pricing primaryTarget={primaryTarget} onCtaClick={onCtaClick} />
        <FAQ onOpen={onFaqOpen} onWhatsAppClick={onWhatsAppClick} />
        <FinalCta primaryTarget={primaryTarget} onCtaClick={() => onCtaClick("final")} />
      </main>
      <Footer onLoginClick={onLoginClick} onWhatsAppClick={onWhatsAppClick} />
    </div>
  );
}
