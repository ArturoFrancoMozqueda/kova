import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import {
  assignCtaSpecificityExperiment,
  hasFunnelClientId,
  trackAnonymousEvent,
  trackAnonymousEventOnce,
  trackExperimentExposed,
  type ExperimentVariant,
} from "@/telemetry/funnel";
import {
  STANDARD_PLAN_AMOUNT,
  STANDARD_PLAN_PRICE_LABEL_ES,
  STANDARD_PLAN_PRICE_CADENCE_ES,
} from "@/billing/standardPlan";
import { BILLING_TRIAL_CTA_LABEL_ES } from "@/billing/trial";
import IntroAnimation from "@/components/brand/IntroAnimation";
import Logo from "@/components/brand/Logo";
import { LogoMark } from "@/components/brand/Logo";
import OwnerDashboard from "@/landing/OwnerDashboard";
import BentoModules from "@/landing/BentoModules";
import FinalCta from "@/landing/FinalCta";
import { ProblemTicket, TicketPaper } from "@/landing/Ticket";
import KovaShowcase from "@/landing/showcase/KovaShowcase";
import { LANDING_STYLES, RESPONSIVE_STYLES, themeVars, type Theme } from "@/landing/landingTheme";
import { copy } from "@/i18n/messages";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support";

const t = copy.landing;

// Theme vars + landing CSS (themeVars, LANDING_STYLES, RESPONSIVE_STYLES) live
// in @/landing/landingTheme so the marketing showcase can reuse them verbatim.

function useLandingRevealMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp-root");
    if (!root) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTargets = Array.from(
      root.querySelectorAll<HTMLElement>(
        [
          ".lp-reveal-block",
          ".lp-benefit-strip",
          ".lp-story-card",
          ".lp-footer-grid",
          // Recibo de precio: mismas data-attrs, pero su CSS imprime las
          // líneas en orden en vez del fade genérico (lp-tkt-print).
          ".lp-ticket-print",
        ].join(",")
      )
    );

    const seen = new Set<HTMLElement>();
    revealTargets.forEach((target, index) => {
      if (seen.has(target)) return;
      seen.add(target);
      target.dataset.lpReveal = "true";
      target.style.setProperty("--lp-reveal-delay", `${Math.min(index % 3, 2) * 80}ms`);
      if (reduceMotion) target.dataset.lpVisible = "true";
    });

    root.classList.add("lp-motion-ready");

    if (reduceMotion || !("IntersectionObserver" in window)) {
      seen.forEach((target) => {
        target.dataset.lpVisible = "true";
      });
      return () => {
        root.classList.remove("lp-motion-ready");
        seen.forEach((target) => {
          target.removeAttribute("data-lp-reveal");
          target.removeAttribute("data-lp-visible");
          target.style.removeProperty("--lp-reveal-delay");
        });
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.dataset.lpVisible = "true";
          observer.unobserve(target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );

    seen.forEach((target) => observer.observe(target));

    return () => {
      observer.disconnect();
      root.classList.remove("lp-motion-ready");
      seen.forEach((target) => {
        target.removeAttribute("data-lp-reveal");
        target.removeAttribute("data-lp-visible");
        target.style.removeProperty("--lp-reveal-delay");
      });
    };
  }, []);
}

/* ─── ThemeToggle ────────────────────────────────────────────────────────── */
/* ─── Navbar ─────────────────────────────────────────────────────────────── */
function Navbar({
  primaryTarget,
  isAuthenticated,
  onCtaClick,
}: {
  primaryTarget: string;
  isAuthenticated: boolean;
  onCtaClick: (cta: string) => void;
}) {
  return (
    <nav
      style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "color-mix(in srgb, var(--page-bg) 85%, transparent)",
        backdropFilter: "saturate(140%) blur(12px)",
        WebkitBackdropFilter: "saturate(140%) blur(12px)",
        borderBottom: "0.5px solid var(--hairline-color)",
      }}
    >
      <div
        className="lp-nav-shell"
        style={{
          maxWidth: 1280, margin: "0 auto",
          padding: "14px 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32,
        }}
      >
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
          {[
            { label: t.nav.howItWorks, href: "#como-funciona" },
            { label: t.nav.whatItLooksLike, href: "#producto" },
            { label: t.nav.isItForMe, href: "#comercios" },
            { label: t.nav.questions, href: "#faq" },
            { label: t.nav.price, href: "#precio" },
          ].map((l) => (
            <a key={l.label} href={l.href} style={{ color: "inherit", textDecoration: "none", transition: "color 150ms" }}
               onMouseEnter={(e) => (e.currentTarget.style.color = "var(--page-fg)")}
               onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {l.label}
            </a>
          ))}
        </div>

        <div className="lp-nav-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isAuthenticated && (
            <Link
              to="/login"
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
            onClick={() => onCtaClick("navbar")}
            style={{
              fontSize: 13, fontWeight: 600,
              background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
              padding: "9px 14px", borderRadius: 8, textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <span>{isAuthenticated ? t.nav.goToDashboard : t.nav.createAccount}</span>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M3 6h6m0 0L6 3m3 3L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─── MXN Ticker ─────────────────────────────────────────────────────────── */
/* ─── Hero ───────────────────────────────────────────────────────────────── */
function Hero({
  primaryTarget,
  primaryCtaLabel,
  onCtaClick,
}: {
  primaryTarget: string;
  primaryCtaLabel: string;
  onCtaClick: (cta: string) => void;
}) {
  const benefits = [
    {
      title: t.threeNodes.items[0].label,
      body: t.threeNodes.items[0].title,
    },
    {
      title: t.threeNodes.items[1].label,
      body: t.threeNodes.items[1].title,
    },
    {
      title: t.threeNodes.items[2].label,
      body: t.threeNodes.items[2].title,
    },
    {
      title: t.bento.items[1].title,
      body: t.bento.items[1].line,
    },
  ];

  return (
    <section className="lp-hero-section" style={{ position: "relative", overflow: "hidden" }}>
      <div className="lp-hero-shell lp-section-inner" style={{ position: "relative" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.95fr) minmax(320px, 0.9fr)",
            gap: 52,
            alignItems: "center",
          }}
          className="lp-hero-grid"
        >
          <div className="lp-hero-content">
            <span
              className="lp-section-label"
              style={{ marginBottom: 18, color: "var(--accent)" }}
            >
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
              {t.hero.titlePart1}<br />
              <span style={{ position: "relative", whiteSpace: "nowrap" }}>
                {t.hero.titleEmphasis}
                <svg
                  viewBox="0 0 200 14" preserveAspectRatio="none"
                  style={{ position: "absolute", bottom: "-0.06em", left: 0, width: "100%", height: "0.18em" }}
                  aria-hidden="true"
                >
                  <path d="M2 8 Q 50 2, 100 7 T 198 6" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              </span>
              {t.hero.titlePart2}
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
                <span>{primaryCtaLabel}</span>
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

            <p
              className="lp-hero-pricing"
              style={{
                marginTop: 16, fontSize: 13, color: "var(--text-muted)",
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
              }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 999,
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                fontWeight: 600, color: "var(--page-fg)",
              }}>
                {STANDARD_PLAN_PRICE_LABEL_ES}
              </span>
              <span>{t.hero.trialBadge}</span>
            </p>
          </div>

          <div className="lp-hero-visual" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 330 }}>
            <IntroAnimation embedded skippable={false} className="lp-hero-logo" />
          </div>
        </div>

        <div className="lp-benefit-strip lp-reveal-block">
          {benefits.map((benefit) => (
            <div className="lp-benefit-card" key={benefit.title}>
              <strong>{benefit.title}</strong>
              <span>{benefit.body}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Problem ────────────────────────────────────────────────────────────── */
// Textura y rotación por recorte, alineadas por índice con p.fragments
// (Libreta=rayado, Excel=celdas, WhatsApp=burbuja, Tickets=punteado, Caja=liso).
const SCRAP_KINDS = ["ruled", "grid", "bubble", "dotted", "plain"] as const;
const SCRAP_ROTATIONS = ["-2.5deg", "1.6deg", "-1.2deg", "2.2deg", "-1.8deg"] as const;

function Problem() {
  const p = t.problem;
  return (
    <section id="problema" className="lp-section lp-reveal-block" style={{ background: "var(--kova-ink)", color: "var(--kova-on-ink)" }}>
      <div className="lp-section-inner" style={{ maxWidth: 1000 }}>
        <span className="lp-section-label" style={{ color: "var(--accent)" }}>{p.eyebrow}</span>
        <h2 className="lp-section-title" style={{ maxWidth: 820, color: "var(--kova-on-ink)" }}>{p.title}</h2>
        <p className="lp-section-copy" style={{ color: "rgba(240,244,255,0.65)" }}>{p.body}</p>

        {/* El desorden (recortes sueltos) contra la respuesta (un corte limpio). */}
        <div
          className="lp-problem-grid"
          style={{
            marginTop: 36, display: "grid",
            gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr)",
            gap: "36px 48px", alignItems: "center",
          }}
        >
          <div>
            <div className="lp-scraps">
              {p.fragments.map((f, i) => (
                <span
                  key={f}
                  className="lp-scrap"
                  data-kind={SCRAP_KINDS[i % SCRAP_KINDS.length]}
                  style={{ ["--scrap-rot" as string]: SCRAP_ROTATIONS[i % SCRAP_ROTATIONS.length] }}
                >
                  {f}
                </span>
              ))}
            </div>
            <p style={{ marginTop: 20, fontSize: 14, color: "var(--text-muted)" }}>{p.fragmentsFoot}</p>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ProblemTicket />
          </div>
        </div>

        <p style={{ marginTop: 40, fontSize: "clamp(20px, 2.4vw, 28px)", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.3, maxWidth: 780, color: "var(--page-fg)" }}>
          {p.punch}
        </p>
      </div>
    </section>
  );
}

/* ─── Differentiation ────────────────────────────────────────────────────── */
function Differentiation() {
  const d = t.diff;
  return (
    <section id="diferencia" className="lp-section lp-reveal-block">
      <div className="lp-section-inner">
        <span className="lp-section-label">{d.eyebrow}</span>
        <h2 className="lp-section-title" style={{ maxWidth: 760 }}>{d.title}</h2>

        <div
          className="lp-3cols"
          style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr 1.12fr", gap: 16, alignItems: "stretch" }}
        >
          {d.columns.map((c) => (
            <div
              key={c.name}
              className="lp-lift"
              style={{
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                borderRadius: 12, padding: "30px 28px",
                display: "flex", flexDirection: "column", gap: 14,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>{c.tag}</span>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--page-fg)" }}>{c.name}</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--text-muted)" }}>{c.body}</p>
            </div>
          ))}
          <div
            className="lp-lift"
            style={{
              background: "var(--surface)", border: "1px solid var(--accent)",
              boxShadow: "0 0 0 4px var(--accent-soft)",
              borderRadius: 12, padding: "30px 28px",
              display: "flex", flexDirection: "column", gap: 14,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--page-fg)" }}>
              <LogoMark size={22} circuitColor="rgba(255,255,255,0.5)" coreColor="var(--kova-blue-light)" />
              {d.kova.tag}
            </span>
            <div style={{ fontSize: 15, color: "var(--text-muted)" }}>{d.kova.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
              {d.kova.points.map((pt) => (
                <span key={pt} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, fontWeight: 500, color: "var(--page-fg)", lineHeight: 1.4 }}>
                  <svg width="16" height="16" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true">
                    <path d="M2 6L5 9L10 3" stroke="var(--kova-growth)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {pt}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p style={{ marginTop: 32, fontSize: "clamp(18px, 2.2vw, 26px)", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.3, maxWidth: 900, color: "var(--page-fg)" }}>{d.punch}</p>
        <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-tertiary)", maxWidth: 720, lineHeight: 1.4 }}>{d.disclaimer}</p>
      </div>
    </section>
  );
}

/* ─── FAQ ────────────────────────────────────────────────────────────────── */
function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const items = t.faq.items;

  return (
    <section id="faq" className="lp-section lp-section-compact lp-reveal-block">
      <div className="lp-section-inner" style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <span className="lp-section-label">
            {t.faq.eyebrow}
          </span>
        </div>
        <h2 className="lp-section-title" style={{ maxWidth: 720 }}>
          {t.faq.title}
        </h2>

        <div style={{ marginTop: 34, borderTop: "0.5px solid var(--hairline-color)" }}>
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderBottom: "0.5px solid var(--hairline-color)" }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
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
                {isOpen && (
                  <div
                    style={{
                      padding: "0 4px 20px",
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "var(--text-muted)",
                      maxWidth: 760,
                      animation: "lp-feed-in 240ms var(--kova-ease-entrance)",
                    }}
                  >
                    {it.a}
                  </div>
                )}
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

        <div style={{ marginTop: 30, maxWidth: 620, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.4, color: "var(--page-fg)" }}>
            <span style={{ color: "var(--accent)" }}>{t.pricing.worthItTitle}</span> {t.pricing.worthItBody}
          </p>
          <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
            {t.pricing.worthItItems.map((it) => (
              <span
                key={it}
                className="lp-chip-lift"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "10px 16px", borderRadius: 999,
                  background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                  fontSize: 13, fontWeight: 500, color: "var(--page-fg)",
                }}
              >
                {it}
              </span>
            ))}
          </div>
        </div>

        <p style={{ marginTop: 36, marginBottom: 0, textAlign: "center", fontSize: 13, fontWeight: 500, letterSpacing: "0.04em", color: "var(--text-muted)" }}>
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
function Footer() {
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
            <div style={{ marginTop: 24, display: "flex", gap: 6, alignItems: "center" }}>
              <span className="lp-live-dot" />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.footer.humansBadge}</span>
            </div>
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
          </div>
        </div>
        <div style={{ marginTop: 64, paddingTop: 24, borderTop: "0.5px solid var(--hairline-color)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-tertiary)", flexWrap: "wrap", gap: 16 }}>
          <span>{t.footer.copyright}</span>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
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
  const [newFunnelVisitor] = useState(() => !hasFunnelClientId());
  const [ctaExperimentVariant, setCtaExperimentVariant] = useState<ExperimentVariant | null>(null);
  const theme: Theme = "dark";

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

  useEffect(() => {
    const variant = assignCtaSpecificityExperiment(
      state.status === "unauthenticated",
      newFunnelVisitor,
    );
    setCtaExperimentVariant(variant);
    if (variant) {
      trackExperimentExposed("exp_01_cta_specificity", variant, "hero");
    }
  }, [newFunnelVisitor, state.status]);

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
      const experiment =
        cta === "hero" && ctaExperimentVariant
          ? {
              experiment_id: "exp_01_cta_specificity",
              variant: ctaExperimentVariant,
            }
          : {};
      void trackAnonymousEvent("landing_cta_clicked", { cta, ...experiment });
      if (primaryTarget === "/signup") {
        void trackAnonymousEvent("signup_started", { cta, ...experiment });
      }
    },
    [ctaExperimentVariant, primaryTarget],
  );

  const primaryCtaLabel =
    ctaExperimentVariant === "treatment" ? BILLING_TRIAL_CTA_LABEL_ES : t.hero.ctaPrimary;

  // Paint html/body with the same landing background while this view is mounted.
  // Prevents the white body bg from showing on viewports wider than the natural
  // .lp-root width (was the right-side white strip on >=1440px monitors).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    const landingBg = "#0F1117"; // matches dark theme --page-bg
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
      <Navbar primaryTarget={primaryTarget} isAuthenticated={isAuthenticated} onCtaClick={onCtaClick} />
      <main>
        <Hero
          primaryTarget={primaryTarget}
          primaryCtaLabel={primaryCtaLabel}
          onCtaClick={onCtaClick}
        />
        {/* Cinematic product showcase (laptop mockup, auto-playing loop).
            Landscape variant tuned for the landing flow; the same component
            powers the standalone /kova-showcase-video export route. */}
        <KovaShowcase
          format="landscape"
          variant="embedded"
          ctaTarget={primaryTarget}
          onCtaClick={() => onCtaClick("showcase")}
        />
        <Problem />
        <OwnerDashboard />
        <BentoModules />
        <Differentiation />
        <FAQ />
        <Pricing primaryTarget={primaryTarget} onCtaClick={onCtaClick} />
        <FinalCta primaryTarget={primaryTarget} onCtaClick={() => onCtaClick("final")} />
      </main>
      <Footer />
    </div>
  );
}
