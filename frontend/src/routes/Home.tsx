import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import {
  STANDARD_PLAN_AMOUNT,
  STANDARD_PLAN_PRICE_LABEL_ES,
  STANDARD_PLAN_PRICE_CADENCE_ES,
} from "@/billing/standardPlan";
import IntroAnimation from "@/components/brand/IntroAnimation";
import Logo from "@/components/brand/Logo";
import { LogoMark } from "@/components/brand/Logo";
import GuidedProductStory from "@/landing/GuidedProductStory";
import OwnerDashboard from "@/landing/OwnerDashboard";
import BentoModules from "@/landing/BentoModules";
import KovaShowcase from "@/landing/showcase/KovaShowcase";
import { LANDING_STYLES, RESPONSIVE_STYLES, themeVars, type Theme } from "@/landing/landingTheme";
import { copy } from "@/i18n/messages";

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
          ".lp-hero-grid",
          ".lp-benefit-strip",
          ".lp-story-card",
          ".lp-footer-grid",
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
}: {
  primaryTarget: string;
  isAuthenticated: boolean;
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
function Hero({ primaryTarget }: { primaryTarget: string }) {
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
          <div>
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
                letterSpacing: "-0.025em",
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

/* ─── BuiltFor ───────────────────────────────────────────────────────────── */
function BuiltFor() {
  const types = t.builtFor.types;
  return (
    <section id="comercios" className="lp-section lp-reveal-block" style={{ background: "var(--kova-ink)", color: "var(--kova-on-ink)" }}>
      <div className="lp-section-inner">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <span className="lp-section-label" style={{ color: "var(--kova-tertiary)" }}>{t.builtFor.eyebrow}</span>
        </div>
        <h2 className="lp-section-title" style={{ maxWidth: 760, color: "var(--kova-on-ink)" }}>
          {t.builtFor.title}
        </h2>
        <p className="lp-section-copy" style={{ color: "rgba(240,244,255,0.65)" }}>
          {t.builtFor.body}
        </p>

        <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.08)" }} className="lp-3cols">
          {types.map((type, i) => (
            <div
              key={type.name}
              style={{ background: "var(--kova-ink)", padding: "24px 22px", display: "flex", flexDirection: "column", gap: 10, minHeight: 170, transition: "background 220ms", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1A1D28")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--kova-ink)")}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-tertiary)" }}>0{i + 1}</span>
                <LogoMark size={22} circuitColor="rgba(255,255,255,0.4)" coreColor="var(--kova-blue-light)" />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.025em", margin: 0, color: "#fff" }}>{type.name}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "rgba(240,244,255,0.6)" }}>{type.body}</p>
              <div style={{ marginTop: "auto", fontSize: 11, color: "var(--kova-blue-light)" }}>↳ {type.tag}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Problem ────────────────────────────────────────────────────────────── */
function Problem() {
  const p = t.problem;
  return (
    <section className="lp-section lp-reveal-block" style={{ background: "var(--kova-ink)", color: "var(--kova-on-ink)" }}>
      <div className="lp-section-inner" style={{ maxWidth: 1000 }}>
        <span className="lp-section-label" style={{ color: "var(--accent)" }}>{p.eyebrow}</span>
        <h2 className="lp-section-title" style={{ maxWidth: 820, color: "var(--kova-on-ink)" }}>{p.title}</h2>
        <p className="lp-section-copy" style={{ color: "rgba(240,244,255,0.65)" }}>{p.body}</p>

        <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {p.fragments.map((f) => (
            <span
              key={f}
              className="lp-chip-lift"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "10px 16px", borderRadius: 999,
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                fontSize: 14, fontWeight: 500, color: "var(--page-fg)",
              }}
            >
              {f}
            </span>
          ))}
        </div>
        <p style={{ marginTop: 18, fontSize: 14, color: "var(--text-muted)" }}>{p.fragmentsFoot}</p>

        <p style={{ marginTop: 32, fontSize: "clamp(20px, 2.4vw, 28px)", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.3, maxWidth: 780, color: "var(--page-fg)" }}>
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
    <section className="lp-section lp-reveal-block">
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
            href="mailto:posprojectsupport@gmail.com"
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
function Pricing({ primaryTarget }: { primaryTarget: string }) {
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
        <div style={{ marginTop: 14, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
          <div
            style={{
              borderRadius: 12, padding: 30,
              background: "var(--kova-ink)", color: "var(--kova-on-ink)",
              border: "0.5px solid var(--kova-ink)",
              boxShadow: "0 24px 60px -20px rgba(15,17,23,0.3)",
              display: "flex", flexDirection: "column", gap: 22, position: "relative",
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--kova-blue-light)" }}>{t.pricing.planName}</div>
              <div style={{ fontSize: 13, marginTop: 6, color: "rgba(240,244,255,0.6)" }}>{t.pricing.planSubtitle}</div>
            </div>

            <div className="tabular" style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 16, opacity: 0.7 }}>$</span>
              <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1 }}>{STANDARD_PLAN_AMOUNT}</span>
              <span style={{ fontSize: 14, opacity: 0.7 }}>{STANDARD_PLAN_PRICE_CADENCE_ES}</span>
            </div>

            <Link
              to={primaryTarget}
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
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(240,244,255,0.55)", marginTop: -10 }}>
              {t.pricing.ctaFineprint}
            </div>

            <div style={{ height: "0.5px", background: "rgba(255,255,255,0.1)" }} />

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {feats.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "rgba(240,244,255,0.85)" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M2 6L5 9L10 3" stroke="var(--kova-blue-light)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
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
              href="mailto:posprojectsupport@gmail.com"
              style={{ display: "inline-flex", marginTop: 16, fontSize: 14, fontWeight: 500, color: "var(--page-fg)", textDecoration: "none", borderBottom: "1px solid var(--hairline-color)" }}
            >
              posprojectsupport@gmail.com
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
            <a href="mailto:posprojectsupport@gmail.com" style={footerLinkStyle}>{t.footer.support}</a>
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
  const theme: Theme = "dark";

  const rootStyle = useMemo(() => themeVars(theme), [theme]);
  useLandingRevealMotion();

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
      <Navbar primaryTarget={primaryTarget} isAuthenticated={isAuthenticated} />
      <main>
        <Hero primaryTarget={primaryTarget} />
        {/* Cinematic product showcase (laptop mockup, auto-playing loop).
            Landscape variant tuned for the landing flow; the same component
            powers the standalone /kova-showcase-video export route. */}
        <KovaShowcase format="landscape" variant="embedded" />
        <Problem />
        <GuidedProductStory />
        <OwnerDashboard />
        <BentoModules />
        <Differentiation />
        <BuiltFor />
        <FAQ />
        <Pricing primaryTarget={primaryTarget} />
      </main>
      <Footer />
    </div>
  );
}
